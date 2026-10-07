/**
 * Worker thread entry for the analysis pool.
 *
 * Receives one file at a time and answers with its analysis, or with the
 * reason it could not be analysed. Built as its own bundle entry so the pool
 * can start it from `dist/`; see `analyze_pool.ts`.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { describe_unknown_error } from '../core/errors.js';
import type { scanned_file } from '../scanner/types.js';
import { analyze_file } from './analyze_file.js';

export interface analyze_request {
  readonly id: number;
  readonly file: scanned_file;
}

export type analyze_response =
  | { readonly id: number; readonly analysis: Awaited<ReturnType<typeof analyze_file>> }
  | { readonly id: number; readonly error: string };

const port = parentPort;
if (port === null) {
  throw new Error('analyze_worker must run as a worker thread');
}

const files = (workerData as { files: ReadonlySet<string> }).files;

port.on('message', (request: analyze_request) => {
  analyze_file(request.file, files).then(
    (analysis) => port.postMessage({ id: request.id, analysis } satisfies analyze_response),
    (error: unknown) =>
      port.postMessage({ id: request.id, error: describe_unknown_error(error) } satisfies analyze_response),
  );
});
