import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { index_project } from '../../src/indexer/index_project.js';
import { watch_project, type watch_handle } from '../../src/indexer/watch_project.js';
import type { index_project_result } from '../../src/indexer/index_project.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project | undefined;
let store: index_store | undefined;
let handle: watch_handle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
  store?.close();
  store = undefined;
  project?.cleanup();
  project = undefined;
});

const DEBOUNCE_MS = 60;

function setup(files: Readonly<Record<string, string>>) {
  project = create_temp_project(files);
  project.backdate_all(60_000);
  store = index_store.open({
    data_dir_path: join(project.root_path, '.code-intelligence'),
    project_root: project.root_path,
    in_memory: true,
  });
  return { project, store };
}

/** Wait for the watcher to notice, debounce and finish reindexing. */
async function wait_for_reindex(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 4));
  await handle?.settled();
}

describe('watch_project', () => {
  it('reindexes after a file is edited', async () => {
    setup({ 'src/a.ts': 'export function alpha() {}\n' });
    await index_project({ store: store!, root_path: project!.root_path });

    handle = watch_project({ store: store!, root_path: project!.root_path, debounce_ms: DEBOUNCE_MS });

    project!.write_file('src/a.ts', 'export function alpha_renamed() {}\n');
    await wait_for_reindex();

    expect(store!.find_symbols_by_name('alpha_renamed')).toHaveLength(1);
    expect(store!.find_symbols_by_name('alpha')).toEqual([]);
  });

  it('picks up a newly created file', async () => {
    setup({ 'src/a.ts': 'export function alpha() {}\n' });
    await index_project({ store: store!, root_path: project!.root_path });

    handle = watch_project({ store: store!, root_path: project!.root_path, debounce_ms: DEBOUNCE_MS });

    project!.write_file('src/new.ts', 'export function fresh() {}\n');
    await wait_for_reindex();

    expect(store!.find_symbols_by_name('fresh')).toHaveLength(1);
  });

  it('drops a deleted file from the index', async () => {
    setup({ 'src/a.ts': 'export function alpha() {}\n', 'src/b.ts': 'export function beta() {}\n' });
    await index_project({ store: store!, root_path: project!.root_path });

    handle = watch_project({ store: store!, root_path: project!.root_path, debounce_ms: DEBOUNCE_MS });

    project!.remove('src/b.ts');
    await wait_for_reindex();

    expect(store!.find_symbols_by_name('beta')).toEqual([]);
    expect(store!.get_file('src/b.ts')).toBeUndefined();
  });

  it('coalesces a burst of edits into a single reindex', async () => {
    // A save in most editors emits several events, and a formatter or a branch
    // switch touches many files at once. Debouncing is what stops that becoming
    // one reindex per event.
    setup({ 'src/a.ts': 'export function alpha() {}\n' });
    await index_project({ store: store!, root_path: project!.root_path });

    const results: index_project_result[] = [];
    handle = watch_project({
      store: store!,
      root_path: project!.root_path,
      debounce_ms: DEBOUNCE_MS,
      on_index: (result) => void results.push(result),
    });

    for (let index = 0; index < 8; index += 1) {
      project!.write_file(`src/burst_${index}.ts`, `export const v${index} = ${index};\n`);
    }
    await wait_for_reindex();

    expect(results.length).toBeLessThanOrEqual(2);
    expect(store!.count().files).toBe(9);
  });

  it('only parses the files that changed', async () => {
    setup({
      'src/a.ts': 'export function alpha() {}\n',
      'src/b.ts': 'export function beta() {}\n',
      'src/c.ts': 'export function gamma() {}\n',
    });
    await index_project({ store: store!, root_path: project!.root_path });

    const results: index_project_result[] = [];
    handle = watch_project({
      store: store!,
      root_path: project!.root_path,
      debounce_ms: DEBOUNCE_MS,
      on_index: (result) => void results.push(result),
    });

    project!.write_file('src/b.ts', 'export function beta_two() {}\n');
    await wait_for_reindex();

    const total_parsed = results.reduce((sum, result) => sum + result.files_parsed, 0);
    expect(total_parsed).toBe(1);
  });

  it('does not loop on its own database writes', async () => {
    // The index lives inside the watched tree. Without filtering, writing it
    // would trigger a reindex, which writes again, forever.
    setup({ 'src/a.ts': 'export function alpha() {}\n' });
    await index_project({ store: store!, root_path: project!.root_path });

    const results: index_project_result[] = [];
    handle = watch_project({
      store: store!,
      root_path: project!.root_path,
      debounce_ms: DEBOUNCE_MS,
      on_index: (result) => void results.push(result),
    });

    project!.write_file('src/a.ts', 'export function alpha_two() {}\n');
    await wait_for_reindex();
    const after_first = results.length;

    // Quiet period: nothing further should fire on its own.
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 6));

    expect(results.length).toBe(after_first);
  });

  it('ignores changes to files the scanner excludes', async () => {
    setup({ 'src/a.ts': 'export function alpha() {}\n' });
    await index_project({ store: store!, root_path: project!.root_path });

    const results: index_project_result[] = [];
    handle = watch_project({
      store: store!,
      root_path: project!.root_path,
      debounce_ms: DEBOUNCE_MS,
      on_index: (result) => void results.push(result),
    });

    project!.write_file('notes.md', '# not source\n');
    await wait_for_reindex();

    // A reindex may run, but it must not add the file.
    expect(store!.get_file('notes.md')).toBeUndefined();
    expect(store!.count().files).toBe(1);
  });

  it('reports it is watching until closed', () => {
    setup({ 'src/a.ts': 'export const a = 1;\n' });
    handle = watch_project({ store: store!, root_path: project!.root_path, debounce_ms: DEBOUNCE_MS });

    expect(handle.is_watching).toBe(true);
    handle.close();
    expect(handle.is_watching).toBe(false);
  });

  it('tolerates being closed twice', () => {
    setup({ 'src/a.ts': 'export const a = 1;\n' });
    handle = watch_project({ store: store!, root_path: project!.root_path, debounce_ms: DEBOUNCE_MS });

    handle.close();
    expect(() => handle?.close()).not.toThrow();
  });

  it('stops reindexing once closed', async () => {
    setup({ 'src/a.ts': 'export function alpha() {}\n' });
    await index_project({ store: store!, root_path: project!.root_path });

    const results: index_project_result[] = [];
    handle = watch_project({
      store: store!,
      root_path: project!.root_path,
      debounce_ms: DEBOUNCE_MS,
      on_index: (result) => void results.push(result),
    });
    handle.close();

    project!.write_file('src/a.ts', 'export function alpha_two() {}\n');
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 4));

    expect(results).toEqual([]);
  });
});
