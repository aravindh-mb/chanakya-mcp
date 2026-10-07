import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { index_project } from '../../src/indexer/index_project.js';
import { index_store, DATABASE_FILE_NAME } from '../../src/store/index_store.js';
import { METADATA_KEYS, SCHEMA_VERSION } from '../../src/store/schema.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project | undefined;
let store: index_store | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
  project?.cleanup();
  project = undefined;
});

const SAMPLE_PROJECT: Readonly<Record<string, string>> = {
  'src/user.service.ts': `
export class user_service {
  async create_user(name: string): Promise<void> {}
  async delete_user(id: string): Promise<void> {}
}
`,
  'src/types.ts': `
export interface user { id: string; name: string }
export type user_id = string;
`,
  'src/app.jsx': 'export const App = () => <div />;\n',
  'README.md': '# not source\n',
};

function open_store(temp: temp_project, in_memory = false): index_store {
  return index_store.open({
    data_dir_path: join(temp.root_path, '.code-intelligence'),
    project_root: temp.root_path,
    in_memory,
  });
}

async function index(temp: temp_project, in_memory = false) {
  store = open_store(temp, in_memory);
  const result = await index_project({ store, root_path: temp.root_path });
  return { store, result };
}

describe('index_project', () => {
  it('indexes a small project end to end', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened, result } = await index(project);

    expect(result.files_added).toBe(3);
    expect(result.files_failed).toBe(0);
    expect(opened.count().files).toBe(3);
  });

  it('skips files the scanner excludes', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);

    expect(opened.get_file('README.md')).toBeUndefined();
  });

  it('makes symbols queryable by name', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);

    const found = opened.find_symbols_by_name('create_user');
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('method');
    expect(found[0]?.file_path).toBe('src/user.service.ts');
    expect(found[0]?.signature).toContain('create_user');
  });

  it('stores containment relationships', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);

    const service = opened.find_symbols_by_name('user_service')[0];
    const edges = opened.get_relationships_from(service?.id ?? '');

    expect(edges.map((edge) => edge.to_name).sort()).toEqual(['create_user', 'delete_user']);
  });

  it('uses posix relative paths as identifiers', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);

    for (const path of [...opened.list_file_hashes().keys()]) {
      expect(path).not.toContain('\\');
    }
  });

  it('records a content hash for every file', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);

    for (const hash of opened.list_file_hashes().values()) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('records when the index was built', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);

    expect(Number(opened.get_metadata(METADATA_KEYS.indexed_at))).toBeGreaterThan(0);
  });

  it('reports a duration', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { result } = await index(project);

    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('reports a timings breakdown that is consistent with the duration', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { result } = await index(project);

    const { timings } = result;
    expect(timings.total_ms).toBe(result.duration_ms);
    for (const key of ['scan_ms', 'analyze_ms', 'write_ms', 'graph_ms'] as const) {
      expect(timings[key]).toBeGreaterThanOrEqual(0);
    }
    // A real project must show up somewhere: scan and analyze happen on actual
    // files, so at least one of them should be nonzero.
    expect(timings.scan_ms + timings.analyze_ms + timings.write_ms).toBeGreaterThan(0);
  });
});

describe('index_project persistence', () => {
  it('writes the database inside the project data directory', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    await index(project);
    store?.close();
    store = undefined;

    expect(existsSync(join(project.root_path, '.code-intelligence', DATABASE_FILE_NAME))).toBe(true);
  });

  it('writes a .gitignore so the index is never committed', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    await index(project);

    const ignore_path = join(project.root_path, '.code-intelligence', '.gitignore');
    expect(readFileSync(ignore_path, 'utf8')).toContain('*');
  });

  it('survives closing and reopening the database', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    await index(project);
    const counts_before = store?.count();
    store?.close();

    store = open_store(project);

    expect(store.count()).toEqual(counts_before);
    expect(store.find_symbols_by_name('create_user')).toHaveLength(1);
  });

  it('rebuilds the index when the schema version changes', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    await index(project);
    store?.set_metadata(METADATA_KEYS.schema_version, String(SCHEMA_VERSION + 1));
    store?.close();

    // Reopening notices the mismatch and starts from an empty, current schema
    // rather than trying to migrate derived data.
    store = open_store(project);

    expect(store.count().files).toBe(0);
    expect(store.get_metadata(METADATA_KEYS.schema_version)).toBe(String(SCHEMA_VERSION));
  });
});

describe('index_project reindexing', () => {
  it('replaces a file rather than duplicating it', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);
    const first = opened.count();

    await index_project({ store: opened, root_path: project.root_path });

    expect(opened.count()).toEqual(first);
  });

  it('reflects edited content on reindex', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);

    project.write_file('src/user.service.ts', 'export class user_service { renamed_method() {} }\n');
    await index_project({ store: opened, root_path: project.root_path });

    expect(opened.find_symbols_by_name('create_user')).toEqual([]);
    expect(opened.find_symbols_by_name('renamed_method')).toHaveLength(1);
  });

  it('changes the content hash when a file changes', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    const { store: opened } = await index(project);
    const before = opened.list_file_hashes().get('src/types.ts');

    project.write_file('src/types.ts', 'export type user_id = number;\n');
    await index_project({ store: opened, root_path: project.root_path });

    expect(opened.list_file_hashes().get('src/types.ts')).not.toBe(before);
  });
});

describe('index_project resilience', () => {
  it('indexes a file with syntax errors and counts it', async () => {
    project = create_temp_project({
      'src/ok.ts': 'export function fine() {}\n',
      'src/broken.ts': 'export function broken( {\n',
    });
    const { store: opened, result } = await index(project);

    expect(result.files_added).toBe(2);
    expect(result.files_with_syntax_errors).toBe(1);
    expect(opened.get_file('src/broken.ts')?.parse_error_count).toBeGreaterThan(0);
  });

  it('still extracts symbols from the parts of a broken file that parsed', async () => {
    project = create_temp_project({ 'src/broken.ts': 'function ok() {}\nclass !!! {}\nfunction two() {}\n' });
    const { store: opened } = await index(project);

    expect(opened.find_symbols_by_name('ok')).toHaveLength(1);
    expect(opened.find_symbols_by_name('two')).toHaveLength(1);
  });

  it('handles an empty project', async () => {
    project = create_temp_project({ 'README.md': '# empty\n' });
    const { result } = await index(project);

    expect(result.files_added).toBe(0);
    expect(result.files_failed).toBe(0);
  });

  it('honours a small batch size', async () => {
    project = create_temp_project(SAMPLE_PROJECT);
    store = open_store(project, true);
    const result = await index_project({ store, root_path: project.root_path, batch_size: 1 });

    expect(result.files_added).toBe(3);
    expect(store.count().files).toBe(3);
  });

  it('passes scan options through', async () => {
    project = create_temp_project({ ...SAMPLE_PROJECT, 'vendor/lib.ts': 'export const v = 1;\n' });
    store = open_store(project, true);

    await index_project({
      store,
      root_path: project.root_path,
      scan: { ignored_directories: ['vendor'] },
    });

    expect(store.get_file('vendor/lib.ts')).toBeUndefined();
  });
});

describe('index_project first-index bulk load', () => {
  it('matches a row-by-row index and leaves every index in place', async () => {
    // 600 files crosses the bulk-load threshold, so a first index drops the
    // secondary indexes and rebuilds them at the end. `force` on an empty
    // database takes the row-by-row path instead, for comparison.
    const files: Record<string, string> = {
      'src/shared.ts': 'export function helper() {}\n',
    };
    for (let index = 0; index < 600; index += 1) {
      files[`src/m${index}.ts`] =
        `import { helper } from './shared';\nexport function f${index}() { helper(); }\n`;
    }
    project = create_temp_project(files);
    project.backdate_all(60_000);

    const snapshot = async (force: boolean): Promise<unknown> => {
      const target = index_store.open({
        data_dir_path: join(project!.root_path, force ? '.row-by-row' : '.bulk'),
        project_root: project!.root_path,
        in_memory: true,
      });
      try {
        await index_project({ store: target, root_path: project!.root_path, force });
        return {
          counts: target.count(),
          callers: target
            .get_relationships_to('src/shared.ts#function:helper')
            .filter((edge) => edge.kind === 'calls')
            .map((edge) => edge.from_id)
            .sort(),
          symbol_hits: target.find_symbols_by_name('f599').map((symbol) => symbol.id),
        };
      } finally {
        target.close();
      }
    };

    const bulk = await snapshot(false);
    const row_by_row = await snapshot(true);

    expect(bulk).toEqual(row_by_row);
    expect((bulk as { callers: string[] }).callers).toHaveLength(600);
  });

  it('restores the secondary indexes after a bulk load', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 520; index += 1) {
      files[`src/m${index}.ts`] = `export const v${index} = ${index};\n`;
    }
    project = create_temp_project(files);
    project.backdate_all(60_000);
    store = open_store(project);
    await index_project({ store, root_path: project.root_path });
    store.close();
    store = undefined;

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(join(project.root_path, '.code-intelligence', DATABASE_FILE_NAME), {
      readonly: true,
    });
    try {
      const names = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'idx_symbols_name',
          'idx_symbols_name_nocase',
          'idx_rel_file_name',
          'idx_refs_name_file',
          'idx_refs_file',
          'idx_imports_file',
        ]),
      );
    } finally {
      db.close();
    }
  });
});
