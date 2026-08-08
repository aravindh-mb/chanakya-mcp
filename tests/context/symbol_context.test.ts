import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get_symbol_context } from '../../src/context/symbol_context.js';
import { index_project } from '../../src/indexer/index_project.js';
import { search_symbols } from '../../src/search/search_symbols.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project;
let store: index_store;

const FILES: Readonly<Record<string, string>> = {
  'src/user.ts': `export class user_service {
  create_user() {}
}
export function helper() {}
`,
  'src/app.ts': `import { user_service, helper } from './user';

export function run() {
  user_service.create_user();
  helper();
}
`,
  'src/index.ts': `export * from './user';
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

function symbol_id_named(name: string): string {
  const hits = search_symbols(store, { query: name }).hits;
  return hits.find((hit) => hit.symbol.name === name)!.symbol.id;
}

describe('get_symbol_context', () => {
  it('describes a class: members, reference usage and module neighborhood', () => {
    const result = get_symbol_context({ store }, symbol_id_named('user_service'));

    expect(result.symbol).toMatchObject({
      name: 'user_service',
      kind: 'class',
      file_path: 'src/user.ts',
      export_kind: 'named',
      signature: 'class user_service',
    });
    expect(result.symbol.start_line).toBe(1);

    expect(result.container.parents).toEqual([]);
    expect(result.container.members.map((member) => member.name)).toEqual(['create_user']);

    expect(result.references.total).toBe(2);
    expect(result.references.uses).toBe(1);
    expect(result.references.distinct_files).toBe(2);
    expect(result.references.files.map((file) => file.file_path)).toEqual(['src/app.ts', 'src/user.ts']);

    const dependents = result.module.dependents.map((dependent) => dependent.file_path).sort();
    expect(dependents).toEqual(['src/app.ts', 'src/index.ts']);
  });

  it('lists the methods a class exposes and who calls a method', () => {
    const class_result = get_symbol_context({ store }, symbol_id_named('user_service'));
    const create_user = class_result.container.members[0]!.id;

    const method_result = get_symbol_context({ store }, create_user);

    expect(method_result.symbol.kind).toBe('method');
    expect(method_result.container.parents.map((parent) => parent.name)).toEqual(['user_service']);
    expect(method_result.callers.total).toBe(1);
    expect(method_result.callers.items[0]).toMatchObject({ name: 'run', file_path: 'src/app.ts' });
  });

  it('reports what a function calls and what its file imports', () => {
    const result = get_symbol_context({ store }, symbol_id_named('run'));

    expect(result.callees.total).toBe(2);
    expect([...result.callees.items.map((callee) => callee.name)].sort()).toEqual([
      'helper',
      'user_service.create_user',
    ]);
    expect(result.module.internal_dependencies).toEqual(['src/user.ts']);
    expect(result.module.packages).toEqual([]);
  });

  it('throws a tool error for an unknown symbol id', () => {
    expect(() => get_symbol_context({ store }, 'missing-id')).toThrow(/no symbol with id/);
  });
});
