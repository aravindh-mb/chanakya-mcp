import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extract_file } from '../../src/extract/extract_file.js';
import { resolve_project_graph } from '../../src/indexer/resolve_project_graph.js';
import { mcp_server } from '../../src/mcp/server.js';
import type { file_analysis } from '../../src/model/file.js';
import { parse_source } from '../../src/parser/parse_file.js';
import { index_store } from '../../src/store/index_store.js';

let store: index_store;

beforeEach(() => {
  store = index_store.open({ data_dir_path: '', project_root: '/project', in_memory: true });
});

afterEach(() => {
  store.close();
});

function analysis_for(relative_path: string, source: string): file_analysis {
  const parsed = parse_source({ source, file_path: relative_path });
  const extracted = extract_file({ parsed, relative_path });
  return {
    file: {
      file_path: relative_path,
      absolute_path: `/project/${relative_path}`,
      language: parsed.language,
      size: source.length,
      modified_time: 0,
      content_hash: `hash-${relative_path}`,
      parse_error_count: 0,
    },
    symbols: extracted.symbols,
    relationships: extracted.relationships,
    imports: extracted.imports,
    exports: extracted.exports,
    references: extracted.references,
  };
}

function new_server(): mcp_server {
  return new mcp_server({
    server_name: 'code-intelligence-mcp',
    server_version: '0.0.0-test',
    store,
    root_path: '/project',
    reindex: async () => ({
      files_added: 0,
      files_updated: 0,
      files_removed: 0,
      files_unchanged: 0,
      files_parsed: 0,
      files_with_syntax_errors: 0,
      files_failed: 0,
      failures: [],
      duration_ms: 0,
    }),
  });
}

/** Send a line through the server and collect the (at most one) response. */
async function send(server: mcp_server, line: string): Promise<unknown> {
  const responses: unknown[] = [];
  server.handle_line(line, (response) => void responses.push(JSON.parse(response)));
  await new Promise((resolve) => setImmediate(resolve));
  return responses[0];
}

describe('mcp_server protocol', () => {
  it('answers initialize with protocol version, capabilities and server info', async () => {
    const server = new_server();

    const response = (await send(
      server,
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    )) as { id: number; result: { protocolVersion: string; capabilities: unknown; serverInfo: unknown } };

    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe('2025-06-18');
    expect(response.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(response.result.serverInfo).toEqual({ name: 'code-intelligence-mcp', version: '0.0.0-test' });
  });

  it('lists all fourteen tools with their json schemas', async () => {
    const server = new_server();

    const response = (await send(
      server,
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    )) as {
      result: { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    };

    expect(response.result.tools).toHaveLength(14);
    for (const tool of response.result.tools) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toHaveProperty('type', 'object');
    }
    expect(response.result.tools.map((tool) => tool.name)).toContain('search_symbols');
    expect(response.result.tools.map((tool) => tool.name)).toContain('get_dependents');
    expect(response.result.tools.map((tool) => tool.name)).toContain('get_symbol_context');
    expect(response.result.tools.map((tool) => tool.name)).toContain('rename_symbol');
  });

  it('calls a tool and wraps the result as text content', async () => {
    store.transaction(() => {
      store.write_file_analysis(
        analysis_for('src/lib.ts', 'export function greet(name: string) { return name; }\n'),
      );
    });
    resolve_project_graph({ store });
    const server = new_server();

    const response = (await send(
      server,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search_symbols', arguments: { query: 'greet' } },
      }),
    )) as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } };

    expect(response.result.isError).toBeUndefined();
    expect(response.result.content[0]!.type).toBe('text');
    const payload = JSON.parse(response.result.content[0]!.text);
    expect(payload.symbols[0].name).toBe('greet');
  });

  it('reports an unknown tool as an invalid-params error', async () => {
    const server = new_server();

    const response = (await send(
      server,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'nope', arguments: {} },
      }),
    )) as { error: { code: number; message: string } };

    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('Unknown tool');
  });

  it('rejects arguments that fail the tool schema', async () => {
    const server = new_server();

    const response = (await send(
      server,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'search_symbols', arguments: { query: '' } },
      }),
    )) as { error: { code: number; message: string } };

    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain('search_symbols');
  });

  it('surfaces business failures as failed tool results, not protocol errors', async () => {
    const server = new_server();

    const response = (await send(
      server,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'get_symbol', arguments: { id: 'src/lib.ts#function:missing' } },
      }),
    )) as { result: { content: Array<{ text: string }>; isError: boolean } };

    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]!.text).toContain("no symbol with id 'src/lib.ts#function:missing'");
  });

  it('answers parse errors with -32700', async () => {
    const server = new_server();

    const response = (await send(server, '{not json')) as { error: { code: number } };

    expect(response.error.code).toBe(-32700);
  });

  it('answers a malformed request with -32600', async () => {
    const server = new_server();

    const response = (await send(server, JSON.stringify({ id: 7 }))) as { error: { code: number } };

    expect(response.error.code).toBe(-32600);
  });

  it('answers an unknown request method with -32601', async () => {
    const server = new_server();

    const response = (await send(
      server,
      JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'prompts/list' }),
    )) as { error: { code: number } };

    expect(response.error.code).toBe(-32601);
  });

  it('never answers a notification', async () => {
    const server = new_server();

    const responses: unknown[] = [];
    server.handle_line(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), (response) =>
      responses.push(response),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(responses).toHaveLength(0);
  });

  it('accepts string request ids', async () => {
    const server = new_server();

    const response = (await send(
      server,
      JSON.stringify({ jsonrpc: '2.0', id: 'req-1', method: 'tools/list' }),
    )) as { id: string };

    expect(response.id).toBe('req-1');
  });
});
