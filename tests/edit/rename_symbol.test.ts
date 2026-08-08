import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rename_symbol } from '../../src/edit/rename_symbol.js';
import { index_project } from '../../src/indexer/index_project.js';
import type { index_project_result } from '../../src/indexer/index_project.js';
import { search_symbols } from '../../src/search/search_symbols.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project;
let store: index_store;

const FILES: Readonly<Record<string, string>> = {
  'src/user.ts': `export class user_service {
  create_user() {}
}
`,
  'src/app.ts': `import { user_service } from './user';

export function run() {
  const u = new user_service();
  u.create_user();
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

describe('rename_symbol', () => {
  it('renames the declaration, uses, and the import binding across files', async () => {
    const result = await rename_symbol({
      store,
      root_path: project.root_path,
      reindex,
      id: symbol_id_named('user_service'),
      new_name: 'user_agent',
    });

    expect(result.old_name).toBe('user_service');
    expect(result.new_name).toBe('user_agent');
    expect(result.files).toHaveLength(2);
    // Definition in src/user.ts, usage and import binding in src/app.ts.
    expect(result.references_renamed).toBe(2);
    expect(result.bindings_renamed).toBe(1);
    expect(result.total_changes).toBe(3);

    expect(on_disk('src/user.ts')).toContain('class user_agent');
    expect(on_disk('src/user.ts')).not.toContain('user_service');
    expect(on_disk('src/app.ts')).toContain("import { user_agent } from './user'");
    expect(on_disk('src/app.ts')).toContain('new user_agent()');
    expect(on_disk('src/app.ts')).not.toContain('user_service');
  });

  it('refuses a name that is not a valid identifier', async () => {
    await expect(
      rename_symbol({
        store,
        root_path: project.root_path,
        reindex,
        id: symbol_id_named('user_service'),
        new_name: 'not-valid',
      }),
    ).rejects.toThrow(/not a valid identifier/);
  });

  it('refuses an unknown symbol id', async () => {
    await expect(
      rename_symbol({
        store,
        root_path: project.root_path,
        reindex,
        id: 'missing-id',
        new_name: 'other',
      }),
    ).rejects.toThrow(/no symbol with id/);
  });

  it('renames nothing when a file drifted, leaving every file untouched', async () => {
    project.write_file('src/app.ts', `${FILES['src/app.ts']}\n// drift\n`);

    await expect(
      rename_symbol({
        store,
        root_path: project.root_path,
        reindex,
        id: symbol_id_named('user_service'),
        new_name: 'user_agent',
      }),
    ).rejects.toThrow(/changed on disk/);

    expect(on_disk('src/user.ts')).toBe(FILES['src/user.ts']);
    expect(on_disk('src/app.ts')).toBe(`${FILES['src/app.ts']}\n// drift\n`);
  });
});

describe('rename_symbol through a barrel', () => {
  let barrel_project: temp_project;
  let barrel_store: index_store;

  const BARREL_FILES: Readonly<Record<string, string>> = {
    'src/user.ts': `export class user_service {
  create_user() {}
}
`,
    'src/index.ts': `export { user_service } from './user';
`,
    'src/app.ts': `import { user_service } from './index';

export function run() {
  return new user_service();
}
`,
  };

  beforeEach(async () => {
    barrel_project = create_temp_project(BARREL_FILES);
    barrel_project.backdate_all(60_000);
    barrel_store = index_store.open({
      data_dir_path: join(barrel_project.root_path, '.code-intelligence'),
      project_root: barrel_project.root_path,
      in_memory: true,
    });
    await index_project({ store: barrel_store, root_path: barrel_project.root_path });
  });

  afterEach(() => {
    barrel_store.close();
    barrel_project.cleanup();
  });

  const barrel_reindex = (): Promise<index_project_result> =>
    index_project({ store: barrel_store, root_path: barrel_project.root_path });

  it('renames the re-export and the import that goes through the barrel', async () => {
    const result = await rename_symbol({
      store: barrel_store,
      root_path: barrel_project.root_path,
      reindex: barrel_reindex,
      id: symbol_id_named('user_service'),
      new_name: 'user_agent',
    });

    expect(result.files).toHaveLength(3);
    const by_path = new Map(result.files.map((file) => [file.file_path, file.changes]));
    expect(by_path.get('src/user.ts')).toBe(1);
    expect(by_path.get('src/index.ts')).toBe(1);
    expect(by_path.get('src/app.ts')).toBe(2);

    const user = readFileSync(barrel_project.resolve_path('src/user.ts'), 'utf8');
    const index_file = readFileSync(barrel_project.resolve_path('src/index.ts'), 'utf8');
    const app = readFileSync(barrel_project.resolve_path('src/app.ts'), 'utf8');

    expect(user).toContain('class user_agent');
    expect(index_file).toBe(`export { user_agent } from './user';\n`);
    expect(app).toContain("import { user_agent } from './index'");
    expect(app).toContain('new user_agent()');
    expect(app).not.toContain('user_service');
  });
});
