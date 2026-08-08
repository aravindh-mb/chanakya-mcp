/**
 * Wire the MCP server to stdio: read newline-delimited requests from `input`
 * and write responses to `output`. One request per line, one response per
 * line, exactly as the MCP stdio transport specifies.
 *
 * Resolves when the client closes the input (EOF), which is how the client
 * asks the server to shut down.
 */

import * as readline from 'node:readline';
import type { index_project_result } from '../indexer/index_project.js';
import type { index_store } from '../store/index_store.js';
import { mcp_server } from './server.js';

export interface run_mcp_server_options {
  readonly server_name: string;
  readonly server_version: string;
  readonly store: index_store;
  /** Project root edit tools address files against, and the staleness check. */
  readonly root_path: string;
  /** Bring the index up to date after an edit writes files. */
  readonly reindex: () => Promise<index_project_result>;
  readonly input?: NodeJS.ReadableStream;
  readonly output_write?: (text: string) => void;
}

export async function run_mcp_server(options: run_mcp_server_options): Promise<void> {
  const input = options.input ?? process.stdin;
  const write = options.output_write ?? ((text: string) => void process.stdout.write(text));

  const server = new mcp_server({
    server_name: options.server_name,
    server_version: options.server_version,
    store: options.store,
    root_path: options.root_path,
    reindex: options.reindex,
  });

  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const respond = (text: string): void => {
    write(text + '\n');
  };

  try {
    for await (const line of lines) {
      if (line.trim() === '') {
        continue;
      }
      // Await each line so requests are handled one at a time; an edit can
      // mutate files and reindex, so responses must not interleave.
      await server.handle_line(line, respond);
    }
  } catch {
    // The input stream was destroyed from under us (e.g. a Ctrl+C shutdown);
    // the client asked us to stop, so this is not an error.
  }
}
