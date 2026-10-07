/**
 * A pool of worker threads that parse and extract files in parallel.
 *
 * Analysis is CPU-bound and per-file independent, and on a large repository it
 * is most of the indexing time, so it is the part worth spreading across
 * cores. Writing stays on the main thread: SQLite has one writer, and the
 * store is synchronous by design.
 *
 * Each worker is given a few files at once rather than one. The main thread
 * blocks while it writes a batch, and a worker holding only one file would sit
 * idle for that whole time after finishing it.
 *
 * The worker is a separate bundle entry (`dist/indexer/analyze_worker.js`).
 * When it is not there — the tests run the TypeScript sources directly — no
 * pool is created and the indexer analyses files in-process, exactly as before.
 */

import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { file_index } from '../extract/module_resolution.js';
import type { file_analysis } from '../model/file.js';
import type { scanned_file } from '../scanner/types.js';
import type { analyze_request, analyze_response } from './analyze_worker.js';

/**
 * More workers than this stop paying for themselves: the main thread, which
 * receives every result and writes it, becomes the bottleneck. Measured on 500
 * VS Code files: 1 worker 17.6s, 4 workers 8.4s, 8 workers 7.6s; on 3,000
 * files: 4 workers 31.1s, 6 workers 32.1s, 8 workers 30.5s — while each worker
 * adds roughly 175 MB of memory.
 */
const MAX_POOL_SIZE = 4;

/** Files a worker holds at once, so it keeps going while the main thread writes. */
const MAX_IN_FLIGHT_PER_WORKER = 4;

/** Starting a worker costs tens of milliseconds; below this much work it is not worth it. */
export const MIN_FILES_FOR_POOL = 64;

export interface analyze_pool {
  analyze(file: scanned_file): Promise<file_analysis>;
  close(): Promise<void>;
}

/** Workers to use when the caller does not say: one core is left for the writer. */
export function default_pool_size(): number {
  return Math.max(1, Math.min(availableParallelism() - 1, MAX_POOL_SIZE));
}

/**
 * Start a pool, or return `undefined` when parallel analysis is unavailable
 * (no built worker script) or pointless (`size` below 2).
 */
export function create_analyze_pool(options: { files: file_index; size: number }): analyze_pool | undefined {
  if (options.size < 2) {
    return undefined;
  }
  const script = find_worker_script();
  if (script === undefined) {
    return undefined;
  }

  interface task {
    readonly request: analyze_request;
    resolve(analysis: file_analysis): void;
    reject(error: Error): void;
  }

  const queue: task[] = [];
  const workers = new Map<Worker, Map<number, task>>();
  let next_id = 0;
  let closed = false;

  const dispatch = (): void => {
    for (const [worker, in_flight] of workers) {
      while (queue.length > 0 && in_flight.size < MAX_IN_FLIGHT_PER_WORKER) {
        const item = queue.shift()!;
        in_flight.set(item.request.id, item);
        worker.postMessage(item.request);
      }
    }
  };

  const spawn = (): void => {
    const worker = new Worker(script, { workerData: { files: options.files } });
    const in_flight = new Map<number, task>();
    workers.set(worker, in_flight);

    worker.on('message', (response: analyze_response) => {
      const item = in_flight.get(response.id);
      in_flight.delete(response.id);
      if (item !== undefined) {
        if ('error' in response) {
          item.reject(new Error(response.error));
        } else {
          item.resolve(response.analysis);
        }
      }
      dispatch();
    });

    // A worker that dies takes only the files it was holding with it: they are
    // recorded as failed and a replacement picks up the rest of the queue.
    let dead = false;
    const on_death = (error: Error): void => {
      if (dead) {
        return;
      }
      dead = true;
      workers.delete(worker);
      for (const item of in_flight.values()) {
        item.reject(error);
      }
      in_flight.clear();
      if (!closed) {
        spawn();
        dispatch();
      }
    };
    worker.on('error', on_death);
    worker.on('exit', (code) => {
      if (!closed) {
        on_death(new Error(`The analysis worker exited unexpectedly (code ${code}).`));
      }
    });
  };

  for (let index = 0; index < options.size; index += 1) {
    spawn();
  }

  return {
    analyze(file: scanned_file): Promise<file_analysis> {
      return new Promise((resolve, reject) => {
        queue.push({ request: { id: next_id++, file }, resolve, reject });
        dispatch();
      });
    },
    async close(): Promise<void> {
      closed = true;
      const all = [...workers.keys()];
      workers.clear();
      await Promise.all(all.map((worker) => worker.terminate()));
    },
  };
}

/**
 * The built worker script, relative to whichever bundle is running: the
 * library entry sits at `dist/index.js` and the CLI at `dist/cli/main.js`.
 */
function find_worker_script(): string | undefined {
  for (const relative of [
    './indexer/analyze_worker.js',
    '../indexer/analyze_worker.js',
    './analyze_worker.js',
  ]) {
    const candidate = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
