/**
 * Benchmark: answering questions about this repo with the code-intelligence
 * MCP server versus the naive "no MCP" workflow (ripgrep / reading files).
 *
 * Both paths are measured in-process on the same machine:
 *  - MCP: the JSON-RPC tools/call round-trip through mcp_server.handle_line,
 *    which is the exact code path a client drives over stdio.
 *  - naive: a fresh ripgrep child process (the binary @vscode/ripgrep ships,
 *    the same one editors bundle), or a file read for structure questions.
 *
 * The point is not to benchmark hardware but the two *interfaces* an agent
 * programs against: one structured query into a prebuilt index, versus a
 * wall-of-matches the agent must then sift and read.
 *
 * Usage: `pnpm run bench` (builds dist first).
 * Writes docs/.vitepress/benchmark.json consumed by the landing page.
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

const project_root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(project_root, 'docs', '.vitepress', 'benchmark.json');
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
        resolve_promise({
          ms: performance.now() - started,
          bytes: Buffer.byteLength(response),
          response: JSON.parse(response),
        });
      })
      .catch(reject_promise);
  });
}

async function naive_rg(args) {
  const started = performance.now();
  const { stdout } = await exec_file(rgPath, args, { cwd: project_root });
  return { ms: performance.now() - started, bytes: Buffer.byteLength(stdout) };
}

async function naive_read(relative_path) {
  const started = performance.now();
  const buffer = await readFile(join(project_root, relative_path));
  return { ms: performance.now() - started, bytes: buffer.length };
}

const data_dir_path = await mkdtemp(join(tmpdir(), 'codebrain-bench-'));
const store = await index_store.open({
  data_dir_path,
  project_root,
  tool_version: 'bench',
});
const index_result = await index_project({ store, root_path: project_root });
const db_bytes = (await stat(join(data_dir_path, DATABASE_FILE_NAME))).size;
const counts = store.count();

const server = new mcp_server({
  server_name: 'codebrain-bench',
  server_version: 'bench',
  store,
  root_path: project_root,
  reindex: async () => index_result,
});

let next_id = 1;
const call = (name, args) => invoke(server, name, args, next_id++);

const symbols = {
  apply_patch: find_symbol_id(store, 'apply_patch'),
  resolve_project_path: find_symbol_id(store, 'resolve_project_path'),
  scan_project: find_symbol_id(store, 'scan_project'),
  mcp_server: find_symbol_id(store, 'mcp_server'),
};

const questions = [
  {
    name: 'Where is apply_patch defined?',
    mcp: [() => call('search_symbols', { query: 'apply_patch', match: 'exact', limit: 5 })],
    naive: () => naive_rg(['-n', '-g', '*.ts', 'apply_patch', 'src', 'tests']),
  },
  {
    name: 'Every use of resolve_project_path',
    mcp: [() => call('find_references', { id: symbols.resolve_project_path })],
    naive: () => naive_rg(['-n', '-g', '*.ts', 'resolve_project_path', 'src', 'tests']),
  },
  {
    name: 'Who calls scan_project?',
    mcp: [() => call('get_callers', { id: symbols.scan_project })],
    naive: () => naive_rg(['-n', '-g', '*.ts', 'scan_project', 'src', 'tests']),
  },
  {
    name: 'What does src/edit/project_file.ts import?',
    mcp: [() => call('get_dependencies', { path: 'src/edit/project_file.ts' })],
    naive: () => naive_rg(['-n', '-g', '*.ts', '^import ', 'src/edit/project_file.ts']),
  },
  {
    name: 'Structure of src/mcp/server.ts',
    mcp: [() => call('get_file_structure', { path: 'src/mcp/server.ts' })],
    naive: () => naive_read('src/mcp/server.ts'),
  },
  {
    name: 'Every occurrence of handle_line in code',
    mcp: [() => call('search_code', { query: 'handle_line', limit: 100 })],
    naive: () => naive_rg(['-n', '-g', '*.ts', 'handle_line', 'src', 'tests']),
  },
  {
    name: 'Full context of the mcp_server class',
    mcp: [() => call('get_symbol_context', { id: symbols.mcp_server })],
    naive: () => naive_rg(['-n', '-g', '*.ts', 'mcp_server', 'src', 'tests']),
  },
];

const results = [];
for (const question of questions) {
  for (let i = 0; i < WARMUP; i += 1) {
    const mcp_calls = [];
    for (const run of question.mcp) mcp_calls.push(await run());
    await question.naive();
  }

  const mcp_samples = [];
  const naive_samples = [];
  for (let i = 0; i < RUNS; i += 1) {
    const mcp_calls = [];
    for (const run of question.mcp) mcp_calls.push(await run());
    mcp_samples.push({
      ms: mcp_calls.reduce((total, run) => total + run.ms, 0),
      bytes: mcp_calls.reduce((total, run) => total + run.bytes, 0),
    });
    naive_samples.push(await question.naive());
  }

  const mcp_ms = median(mcp_samples.map((sample) => sample.ms));
  const naive_ms = median(naive_samples.map((sample) => sample.ms));
  const mcp_bytes = median(mcp_samples.map((sample) => sample.bytes));
  const naive_bytes = median(naive_samples.map((sample) => sample.bytes));

  results.push({
    name: question.name,
    mcp: { median_ms: round(mcp_ms), median_bytes: Math.round(mcp_bytes) },
    naive: { median_ms: round(naive_ms), median_bytes: Math.round(naive_bytes) },
    speedup: round(naive_ms / mcp_ms),
    context_saved_pct: round(((naive_bytes - mcp_bytes) / naive_bytes) * 100),
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
    files: counts.files,
    symbols: counts.symbols,
    references: counts.references,
    reference_names: counts.reference_names,
  },
  index: {
    duration_ms: index_result.duration_ms,
    scan_ms: index_result.timings.scan_ms,
    analyze_ms: index_result.timings.analyze_ms,
    write_ms: index_result.timings.write_ms,
    graph_ms: index_result.timings.graph_ms,
    db_bytes,
    files_parsed: index_result.files_parsed,
  },
  questions: results,
  summary: {
    median_speedup: round(median(speedups)),
    mean_speedup: round(speedups.reduce((total, value) => total + value, 0) / speedups.length),
    context_bytes_naive: naive_total_bytes,
    context_bytes_mcp: mcp_total_bytes,
    context_saved_pct: round(((naive_total_bytes - mcp_total_bytes) / naive_total_bytes) * 100),
  },
};

await mkdir(dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(benchmark, null, 2)}\n`);

console.log('code-intelligence/mcp benchmark');
console.log(
  `  index: ${index_result.duration_ms}ms (scan ${index_result.timings.scan_ms}ms, analyze ${index_result.timings.analyze_ms}ms, write ${index_result.timings.write_ms}ms, graph ${index_result.timings.graph_ms}ms), ${counts.files} files, ${counts.symbols} symbols, db ${(db_bytes / 1024 / 1024).toFixed(2)}MB`,
);
console.table(
  results.map((result) => ({
    question: result.name,
    'mcp ms': result.mcp.median_ms,
    'naive ms': result.naive.median_ms,
    'mcp bytes': result.mcp.median_bytes,
    'naive bytes': result.naive.median_bytes,
    speedup: `${result.speedup}x`,
    'context saved': `${result.context_saved_pct}%`,
  })),
);
console.log(`wrote ${OUT_PATH}`);
