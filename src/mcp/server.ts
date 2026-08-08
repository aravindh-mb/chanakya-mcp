/**
 * A minimal Model Context Protocol server over newline-delimited JSON-RPC 2.0.
 *
 * The client writes one JSON object per line on stdin; the server writes one
 * JSON object per line on stdout. This implements the stdio transport from the
 * MCP specification: `initialize`, `tools/list` and `tools/call`, plus the
 * `notifications/initialized` and `notifications/cancelled` notifications
 * (which are acknowledged by being ignored). Nothing else is required of a
 * read-only server.
 *
 * Parsing is tolerant in the MCP spirit: we skip blank lines, and unknown
 * methods and malformed requests produce the right JSON-RPC error instead of
 * a crash.
 */

import { z } from 'zod';
import type { index_project_result } from '../indexer/index_project.js';
import type { index_store } from '../store/index_store.js';
import { tool_error } from './errors.js';
import { list_tools } from './tools.js';
import type { mcp_tool, tool_context } from './tools.js';

const PROTOCOL_VERSION = '2025-06-18';

const rpc_request = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

const rpc_notification = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

const tools_call_params = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export interface mcp_server_options {
  readonly server_name: string;
  readonly server_version: string;
  readonly store: index_store;
  /** Project root edit tools address files against, and the staleness check. */
  readonly root_path: string;
  /** Bring the index up to date after an edit writes files. */
  readonly reindex: () => Promise<index_project_result>;
  readonly tools?: readonly mcp_tool[];
}

export class mcp_server {
  readonly #server_name: string;
  readonly #server_version: string;
  readonly #store: index_store;
  readonly #root_path: string;
  readonly #reindex: () => Promise<index_project_result>;
  readonly #tools: ReadonlyMap<string, mcp_tool>;

  constructor(options: mcp_server_options) {
    this.#server_name = options.server_name;
    this.#server_version = options.server_version;
    this.#store = options.store;
    this.#root_path = options.root_path;
    this.#reindex = options.reindex;
    this.#tools = new Map((options.tools ?? list_tools()).map((tool) => [tool.name, tool]));
  }

  /** Handle one client line; `respond` is called at most once, never for a notification. */
  async handle_line(line: string, respond: (response: string) => void): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      respond(rpc_error(-32700, 'Parse error', undefined));
      return;
    }
    await this.#dispatch(parsed, respond);
  }

  async #dispatch(parsed: unknown, respond: (response: string) => void): Promise<void> {
    if (typeof parsed !== 'object' || parsed === null || !('id' in (parsed as Record<string, unknown>))) {
      const notification = rpc_notification.safeParse(parsed);
      if (!notification.success) {
        respond(rpc_error(-32600, 'Invalid Request', undefined));
      }
      // Notifications are never answered, whatever their method is.
      return;
    }

    const request = rpc_request.safeParse(parsed);
    if (!request.success) {
      respond(rpc_error(-32600, 'Invalid Request', undefined));
      return;
    }

    switch (request.data.method) {
      case 'initialize':
        this.#handle_initialize(request.data, respond);
        return;
      case 'tools/list':
        this.#handle_tools_list(request.data, respond);
        return;
      case 'tools/call':
        await this.#handle_tools_call(request.data, respond);
        return;
      default:
        respond(rpc_error(-32601, `Method not found: ${request.data.method}`, undefined));
    }
  }

  #handle_initialize(request: { id: number | string }, respond: (response: string) => void): void {
    respond(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: this.#server_name,
            version: this.#server_version,
          },
        },
      }),
    );
  }

  #handle_tools_list(request: { id: number | string }, respond: (response: string) => void): void {
    respond(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [...this.#tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: json_schema_of(tool),
          })),
        },
      }),
    );
  }

  async #handle_tools_call(
    request: { id: number | string; params?: unknown },
    respond: (response: string) => void,
  ): Promise<void> {
    const checked = tools_call_params.safeParse(request.params);
    if (!checked.success) {
      respond(rpc_error(-32602, `Invalid tool arguments: ${format_zod_error(checked.error)}`, undefined));
      return;
    }

    const tool = this.#tools.get(checked.data.name);
    if (tool === undefined) {
      respond(rpc_error(-32602, `Unknown tool: ${checked.data.name}`, undefined));
      return;
    }

    const validated = tool.schema.safeParse(checked.data.arguments);
    if (!validated.success) {
      respond(
        rpc_error(
          -32602,
          `Invalid arguments for '${tool.name}': ${format_zod_error(validated.error)}`,
          undefined,
        ),
      );
      return;
    }

    try {
      const ctx: tool_context = { store: this.#store, root_path: this.#root_path, reindex: this.#reindex };
      const result = await tool.call(ctx, validated.data);
      respond(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          },
        }),
      );
    } catch (error) {
      if (error instanceof tool_error) {
        respond(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{ type: 'text', text: error.message }],
              isError: true,
            },
          }),
        );
      } else {
        respond(rpc_error(-32603, error instanceof Error ? error.message : String(error), undefined));
      }
    }
  }
}

function json_schema_of(tool: mcp_tool): unknown {
  return z.toJSONSchema(tool.schema, { target: 'draft-07' });
}

function format_zod_error(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
}

function rpc_error(code: number, message: string, id: number | string | undefined): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data: undefined } });
}
