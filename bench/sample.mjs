/**
 * Benchmark: answering questions about a realistic sample application with the
 * code-intelligence MCP server versus the naive "no MCP" workflow.
 *
 * `bench/compare.mjs` measures this repository, which is unusual code — a
 * parser and an indexer. This script measures `bench/sample-project`, a small
 * full-stack monorepo (Express-shaped API, React frontend, shared package) that
 * looks like what people actually build, so the numbers are representative of
 * an ordinary application rather than of a compiler.
 *
 * Both paths are measured in-process on the same machine:
 *  - MCP: the JSON-RPC `tools/call` round-trip through `mcp_server.handle_line`,
 *    the exact code path a client drives over stdio.
 *  - naive: a fresh ripgrep child process (the binary editors bundle), or a
 *    file read where the question is about structure.
 *
 * Two things are measured, and only one of them is about speed:
 *
 *  - **Latency.** Interesting but not the point; both are fast on 16 files.
 *  - **Bytes returned.** This is the point. Every byte a tool hands back becomes
 *    tokens in the agent's context. `naive` bytes are what an agent would have
 *    to read and sift; MCP bytes are the answer.
 *
 * The naive path is given a fair shot: it uses ripgrep, not a naive file walk,
 * and the pattern is one a competent agent would actually write. What it cannot
 * do is know which of its matches is the *definition*, which is a *call*, and
 * which is an unrelated string — that sifting is the work the index removes.
 *
 * Usage: `pnpm run bench:sample` (builds dist first).
 * Writes docs/.vitepress/sample-benchmark.json, consumed by the docs page.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { rgPath } from '@vscode/ripgrep';
import { index_project, index_store, mcp_server, search_symbols, DATABASE_FILE_NAME } from '../dist/index.js';

const exec_file = promisify(execFile);

const bench_dir = dirname(fileURLToPath(import.meta.url));
const repo_root = resolve(bench_dir, '..');
const project_root = join(bench_dir, 'sample-project');
const OUT_PATH = join(repo_root, 'docs', '.vitepress', 'sample-benchmark.json');
const RUNS = 11;
const WARMUP = 1;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value, digits = 2) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

/** Rough, and labelled as rough: ~4 characters per token for source-like text. */
function to_tokens(bytes) {
  return Math.round(bytes / 4);
}

function find_symbol_id(store, name) {
  const result = search_symbols(store, { query: name, match: 'exact', limit: 1 });
  if (result.hits.length === 0) {
    throw new Error(`setup: no symbol found for '${name}'`);
  }
  return result.hits[0].symbol.id;
}

async function invoke(server, name, args, id) {
  return new Promise((resolve_promise, reject_promise) => {
    const line = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const started = performance.now();
    server
      .handle_line(line, (response) => {
        resolve_promise({ ms: performance.now() - started, bytes: Buffer.byteLength(response) });
      })
      .catch(reject_promise);
  });
}

/**
 * ripgrep, then read the files it hit — which is what an agent actually does.
 *
 * Measuring raw grep output alone flatters the naive path and is the wrong
 * comparison. A wall of `path:line:text` does not tell an agent which match is
 * the *declaration*, which is a *call*, and which is an unrelated string in a
 * comment. To find out it opens the files, and those bytes land in its context
 * just the same. So the honest naive cost is the match list plus the distinct
 * files it points at.
 *
 * Raw grep bytes are still reported separately, so the two can be compared.
 */
async function naive_rg(args) {
  const started = performance.now();
  let stdout = '';
  try {
    ({ stdout } = await exec_file(rgPath, args, { cwd: project_root }));
  } catch (error) {
    // ripgrep exits 1 when nothing matched; that is a result, not a failure.
    if (error.code !== 1) {
      throw error;
    }
  }

  const grep_bytes = Buffer.byteLength(stdout);
  const hit_files = new Set(
    stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(':')[0])
      .filter(Boolean),
  );

  let read_bytes = 0;
  for (const relative_path of hit_files) {
    try {
      read_bytes += (await readFile(join(project_root, relative_path))).length;
    } catch {
      // A path ripgrep printed that cannot be read is not worth failing over.
    }
  }

  return {
    ms: performance.now() - started,
    bytes: grep_bytes + read_bytes,
    grep_bytes,
    files_opened: hit_files.size,
  };
}

/** Reading whole files, which is what an agent falls back to for structure. */
async function naive_read(...relative_paths) {
  const started = performance.now();
  let bytes = 0;
  for (const relative_path of relative_paths) {
    bytes += (await readFile(join(project_root, relative_path))).length;
  }
  return {
    ms: performance.now() - started,
    bytes,
    grep_bytes: 0,
    files_opened: relative_paths.length,
  };
}

const data_dir_path = await mkdtemp(join(tmpdir(), 'codebrain-sample-'));
const store = await index_store.open({ data_dir_path, project_root, tool_version: 'bench' });
const index_result = await index_project({ store, root_path: project_root });
const db_bytes = (await stat(join(data_dir_path, DATABASE_FILE_NAME))).size;
const counts = store.count();

const server = new mcp_server({
  server_name: 'codebrain-sample-bench',
  server_version: 'bench',
  store,
  root_path: project_root,
  reindex: async () => index_result,
});

let next_id = 1;
const call = (name, args) => invoke(server, name, args, next_id++);

const symbols = {
  create_user: find_symbol_id(store, 'create_user'),
  user_service: find_symbol_id(store, 'user_service'),
  format_money: find_symbol_id(store, 'format_money'),
  use_orders: find_symbol_id(store, 'use_orders'),
};

/**
 * Questions chosen to be the ones an agent actually asks before editing:
 * find the thing, see its shape, find everything that touches it, understand
 * the blast radius of a change.
 */
const questions = [
  {
    name: 'Where is create_user defined?',
    ask: 'Locating a symbol before editing it.',
    mcp: () => call('search_symbols', { query: 'create_user', match: 'exact', limit: 5 }),
    naive: () => naive_rg(['-n', '--glob', '*.ts*', 'create_user', '.']),
  },
  {
    name: 'Everything that uses format_money',
    ask: 'The blast radius of changing a shared helper.',
    mcp: () => call('find_references', { id: symbols.format_money }),
    naive: () => naive_rg(['-n', '--glob', '*.ts*', 'format_money', '.']),
  },
  {
    name: 'Who calls user_service.create_user?',
    ask: 'Finding callers before changing a signature.',
    mcp: () => call('get_callers', { id: symbols.create_user }),
    naive: () => naive_rg(['-n', '--glob', '*.ts*', 'create_user', '.']),
  },
  {
    name: 'What does the user service depend on?',
    ask: 'Understanding a module before touching it.',
    mcp: () => call('get_dependencies', { path: 'apps/api/src/services/user.service.ts' }),
    naive: () => naive_read('apps/api/src/services/user.service.ts'),
  },
  {
    name: 'What breaks if I change the shared types?',
    ask: 'Cross-package impact in a monorepo.',
    mcp: () => call('get_dependents', { path: 'packages/shared/src/types.ts' }),
    naive: () => naive_rg(['-n', '--glob', '*.ts*', '@sample/shared', '.']),
  },
  {
    name: 'Structure of the user service',
    ask: 'Seeing a class outline without reading it.',
    mcp: () => call('get_file_structure', { path: 'apps/api/src/services/user.service.ts' }),
    naive: () => naive_read('apps/api/src/services/user.service.ts'),
  },
  {
    name: 'Which React components use the orders hook?',
    ask: 'Tracing a hook through the frontend.',
    mcp: () => call('find_references', { id: symbols.use_orders }),
    naive: () => naive_rg(['-n', '--glob', '*.tsx', 'use_orders', '.']),
  },
  {
    name: 'Full working context for user_service',
    ask: 'Everything an agent needs before a refactor: one call versus reading the layer.',
    mcp: () => call('get_symbol_context', { id: symbols.user_service }),
    naive: () =>
      naive_read(
        'apps/api/src/services/user.service.ts',
        'apps/api/src/repositories/user.repository.ts',
        'apps/api/src/routes/user.routes.ts',
        'apps/api/src/server.ts',
      ),
  },
];

const results = [];
for (const question of questions) {
  for (let i = 0; i < WARMUP; i += 1) {
    await question.mcp();
    await question.naive();
  }

  const mcp_samples = [];
  const naive_samples = [];
  for (let i = 0; i < RUNS; i += 1) {
    mcp_samples.push(await question.mcp());
    naive_samples.push(await question.naive());
  }

  const mcp_ms = median(mcp_samples.map((sample) => sample.ms));
  const naive_ms = median(naive_samples.map((sample) => sample.ms));
  const mcp_bytes = median(mcp_samples.map((sample) => sample.bytes));
  const naive_bytes = median(naive_samples.map((sample) => sample.bytes));
  const naive_grep_bytes = median(naive_samples.map((sample) => sample.grep_bytes));
  const files_opened = median(naive_samples.map((sample) => sample.files_opened));

  results.push({
    name: question.name,
    ask: question.ask,
    mcp: { median_ms: round(mcp_ms), median_bytes: Math.round(mcp_bytes), tokens: to_tokens(mcp_bytes) },
    naive: {
      median_ms: round(naive_ms),
      median_bytes: Math.round(naive_bytes),
      tokens: to_tokens(naive_bytes),
      grep_only_bytes: Math.round(naive_grep_bytes),
      grep_only_tokens: to_tokens(naive_grep_bytes),
      files_opened: Math.round(files_opened),
    },
    speedup: round(naive_ms / mcp_ms),
    context_saved_pct: naive_bytes === 0 ? 0 : round(((naive_bytes - mcp_bytes) / naive_bytes) * 100),
  });
}

store.close();
await rm(data_dir_path, { recursive: true, force: true });

const speedups = results.map((result) => result.speedup);
const naive_total_bytes = results.reduce((total, result) => total + result.naive.median_bytes, 0);
const mcp_total_bytes = results.reduce((total, result) => total + result.mcp.median_bytes, 0);

const benchmark = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  node_version: process.version,
  runs: RUNS,
  project: {
    name: 'sample-project',
    description: 'Express-shaped API, React frontend and a shared package in a small monorepo',
    files: counts.files,
    symbols: counts.symbols,
    references: counts.references,
  },
  index: {
    duration_ms: index_result.duration_ms,
    db_bytes,
    files_parsed: index_result.files_parsed,
  },
  questions: results,
  summary: {
    median_speedup: round(median(speedups)),
    context_bytes_naive: naive_total_bytes,
    context_bytes_mcp: mcp_total_bytes,
    context_tokens_naive: to_tokens(naive_total_bytes),
    context_tokens_mcp: to_tokens(mcp_total_bytes),
    context_saved_pct: round(((naive_total_bytes - mcp_total_bytes) / naive_total_bytes) * 100),
  },
};

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(benchmark, null, 2)}\n`);

console.log('sample-project benchmark');
console.log(
  `  index: ${index_result.duration_ms}ms, ${counts.files} files, ${counts.symbols} symbols, db ${(db_bytes / 1024).toFixed(0)}KB`,
);
console.table(
  results.map((result) => ({
    question: result.name,
    'mcp ms': result.mcp.median_ms,
    'rg ms': result.naive.median_ms,
    'mcp tokens': result.mcp.tokens,
    'grep only': result.naive.grep_only_tokens,
    'agent tokens': result.naive.tokens,
    files: result.naive.files_opened,
    saved: `${result.context_saved_pct}%`,
  })),
);
console.log(
  `  totals: ${benchmark.summary.context_tokens_naive} -> ${benchmark.summary.context_tokens_mcp} tokens ` +
    `(${benchmark.summary.context_saved_pct}% less context), median ${benchmark.summary.median_speedup}x faster`,
);
console.log(`wrote ${OUT_PATH}`);
