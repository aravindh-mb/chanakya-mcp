import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { index_project } from '../../src/indexer/index_project.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project | undefined;
let store: index_store | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
  project?.cleanup();
  project = undefined;
});

const FILES: Readonly<Record<string, string>> = {
  'src/a.ts': 'export function alpha() {}\n',
  'src/b.ts': 'export function beta() {}\n',
  'src/c.ts': 'export function gamma() {}\n',
};

function setup(files: Readonly<Record<string, string>> = FILES) {
  project = create_temp_project(files);
  // Fixtures are written microseconds before indexing, which makes them racily
  // clean. Backdating makes them behave like a real project's settled files.
  project.backdate_all(60_000);
  store = index_store.open({
    data_dir_path: join(project.root_path, '.code-intelligence'),
    project_root: project.root_path,
    in_memory: true,
  });
  return { project, store };
}

async function reindex() {
  return index_project({ store: store!, root_path: project!.root_path });
}

describe('incremental indexing', () => {
  it('parses every file on the first run', async () => {
    setup();
    const result = await reindex();

    expect(result.files_added).toBe(3);
    expect(result.files_parsed).toBe(3);
  });

  it('parses nothing when nothing changed', async () => {
    // The core promise of this phase: a no-op run must not reparse the project.
    setup();
    await reindex();
    const second = await reindex();

    expect(second.files_parsed).toBe(0);
    expect(second.files_unchanged).toBe(3);
    expect(second.files_added).toBe(0);
    expect(second.files_updated).toBe(0);
  });

  it('parses only the file that changed', async () => {
    setup();
    await reindex();

    project!.write_file('src/b.ts', 'export function beta_renamed() {}\n');
    const second = await reindex();

    expect(second.files_parsed).toBe(1);
    expect(second.files_updated).toBe(1);
    expect(second.files_unchanged).toBe(2);
  });

  it('reflects the edit in the index', async () => {
    setup();
    await reindex();

    project!.write_file('src/b.ts', 'export function beta_renamed() {}\n');
    await reindex();

    expect(store!.find_symbols_by_name('beta')).toEqual([]);
    expect(store!.find_symbols_by_name('beta_renamed')).toHaveLength(1);
    expect(store!.find_symbols_by_name('alpha')).toHaveLength(1);
  });

  it('indexes a newly added file without touching the others', async () => {
    setup();
    await reindex();

    project!.write_file('src/d.ts', 'export function delta() {}\n');
    const second = await reindex();

    expect(second.files_added).toBe(1);
    expect(second.files_parsed).toBe(1);
    expect(store!.find_symbols_by_name('delta')).toHaveLength(1);
  });

  it('removes a deleted file and everything derived from it', async () => {
    setup();
    await reindex();

    project!.remove('src/c.ts');
    const second = await reindex();

    expect(second.files_removed).toBe(1);
    expect(second.files_parsed).toBe(0);
    expect(store!.get_file('src/c.ts')).toBeUndefined();
    expect(store!.find_symbols_by_name('gamma')).toEqual([]);
    expect(store!.count().files).toBe(2);
  });

  it('does not rewrite a file that was touched but not edited', async () => {
    // What `git checkout` does: mtime changes, content does not. The cheap check
    // flags it, the hash clears it, and the database is left alone.
    setup();
    await reindex();

    const future = new Date(Date.now() + 10_000);
    utimesSync(project!.resolve_path('src/a.ts'), future, future);
    const second = await reindex();

    expect(second.files_parsed).toBe(1); // it had to look
    expect(second.files_updated).toBe(0); // but nothing was written
    expect(second.files_unchanged).toBe(3);
  });

  it('detects an edit that leaves the file the same size', async () => {
    // Same byte count, different content. Size alone would miss this; mtime
    // catches it and the hash confirms it.
    setup({ 'src/a.ts': 'export const value = 111;\n' });
    await reindex();

    project!.write_file('src/a.ts', 'export const value = 222;\n');
    const second = await reindex();

    expect(second.files_updated).toBe(1);
  });

  it('handles a simultaneous add, edit and delete', async () => {
    setup();
    await reindex();

    project!.write_file('src/a.ts', 'export function alpha_two() {}\n');
    project!.write_file('src/new.ts', 'export function fresh() {}\n');
    project!.remove('src/c.ts');
    const second = await reindex();

    expect(second.files_added).toBe(1);
    expect(second.files_updated).toBe(1);
    expect(second.files_removed).toBe(1);
    expect(second.files_unchanged).toBe(1);
    expect(store!.count().files).toBe(3);
  });

  it('reparses everything when forced', async () => {
    setup();
    await reindex();

    const forced = await index_project({ store: store!, root_path: project!.root_path, force: true });

    expect(forced.files_parsed).toBe(3);
    expect(forced.files_added).toBe(3);
  });

  it('keeps symbol counts stable across repeated no-op runs', async () => {
    setup();
    await reindex();
    const counts = store!.count();

    await reindex();
    await reindex();

    expect(store!.count()).toEqual(counts);
  });
});
