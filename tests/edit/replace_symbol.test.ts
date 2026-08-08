import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { replace_symbol } from '../../src/edit/replace_symbol.js';
import { index_project } from '../../src/indexer/index_project.js';
import type { index_project_result } from '../../src/indexer/index_project.js';
import { search_symbols } from '../../src/search/search_symbols.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project;
let store: index_store;

const FILES: Readonly<Record<string, string>> = {
  'src/greeter.ts': `export function greet(name: string): string {
  return \`hello \${name}\`;
}
`,
};

beforeEach(async () => {
  project = create_temp_project(FILES);
  project.backdate_all(60_000);
  store = index_store.open({
    data_dir_path: join(project.root_path, '.code-intelligence'),
    project_root: project.root_path,
    in_memory: true,
  });
  await index_project({ store, root_path: project.root_path });
});

afterEach(() => {
  store.close();
  project.cleanup();
});

const reindex = (): Promise<index_project_result> => index_project({ store, root_path: project.root_path });

function on_disk(relative_path: string): string {
  return readFileSync(project.resolve_path(relative_path), 'utf8');
}

function symbol_id_named(name: string): string {
  const hits = search_symbols(store, { query: name }).hits;
  return hits.find((hit) => hit.symbol.name === name)!.symbol.id;
}

describe('replace_symbol', () => {
  it('splices new source over the whole declaration, leaving modifiers intact', async () => {
    const result = await replace_symbol({
      store,
      root_path: project.root_path,
      reindex,
      id: symbol_id_named('greet'),
      new_source: 'function greet(name: string): string {\n  return `hi ${name}`;\n}',
    });

    expect(result.name).toBe('greet');
    expect(on_disk('src/greeter.ts')).toBe(
      'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n',
    );
  });

  it('refuses an unknown symbol id', async () => {
    await expect(
      replace_symbol({
        store,
        root_path: project.root_path,
        reindex,
        id: 'missing-id',
        new_source: 'x',
      }),
    ).rejects.toThrow(/no symbol with id/);
  });

  it('refuses when the file drifted from the index', async () => {
    project.write_file('src/greeter.ts', `${FILES['src/greeter.ts']}\n// drift\n`);

    await expect(
      replace_symbol({
        store,
        root_path: project.root_path,
        reindex,
        id: symbol_id_named('greet'),
        new_source: 'x',
      }),
    ).rejects.toThrow(/changed on disk/);
  });
});
