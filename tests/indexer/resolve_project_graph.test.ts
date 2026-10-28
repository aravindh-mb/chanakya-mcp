import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extract_file } from '../../src/extract/extract_file.js';
import { resolve_project_graph } from '../../src/indexer/resolve_project_graph.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { file_analysis } from '../../src/model/file.js';
import type { relationship } from '../../src/model/relationship.js';
import { index_store } from '../../src/store/index_store.js';

let store: index_store;

beforeEach(() => {
  store = index_store.open({ data_dir_path: '', project_root: '/project', in_memory: true });
});

afterEach(() => {
  store.close();
});

function analysis_for(relative_path: string, source: string): file_analysis {
  const parsed = parse_source({ source, file_path: relative_path });
  const extracted = extract_file({ parsed, relative_path });
  return {
    file: {
      file_path: relative_path,
      absolute_path: `/project/${relative_path}`,
      language: parsed.language,
      size: source.length,
      modified_time: 0,
      content_hash: `hash-${relative_path}`,
      parse_error_count: 0,
    },
    symbols: extracted.symbols,
    relationships: extracted.relationships,
    imports: extracted.imports,
    exports: extracted.exports,
    references: extracted.references,
  };
}

function index(files: ReadonlyArray<readonly [string, string]>): void {
  store.transaction(() => {
    for (const [relative_path, source] of files) {
      store.write_file_analysis(analysis_for(relative_path, source));
    }
  });
  resolve_project_graph({ store });
}

function calls(edges: readonly relationship[]): readonly relationship[] {
  return edges.filter((edge) => edge.kind === 'calls');
}

const USER = `export default class session {
  open() {}
}
export class user_service {
  create_user() {}
}
export function helper() {}
`;

describe('resolve_project_graph: call edges', () => {
  it('resolves a call through a named import', () => {
    index([
      ['src/user.ts', USER],
      [
        'src/app.ts',
        "import { user_service } from './user';\nfunction main() { user_service.create_user(); }\n",
      ],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges).toHaveLength(1);
    const edge = edges[0]!;
    expect(edge.to_name).toBe('user_service.create_user');
    expect(edge.to_id).toBe('src/user.ts#method:user_service.create_user');
    expect(edge.confidence).toBe('resolved');
  });

  it('resolves a call through a default import', () => {
    index([
      ['src/user.ts', USER],
      ['src/app.ts', "import session from './user';\nfunction main() { session.open(); }\n"],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges[0]?.to_id).toBe('src/user.ts#method:session.open');
  });

  it('resolves a call through a namespace import', () => {
    index([
      ['src/user.ts', USER],
      ['src/app.ts', "import * as u from './user';\nfunction main() { u.helper(); }\n"],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges[0]?.to_id).toBe('src/user.ts#function:helper');
  });

  it('follows a re-export chain to the defining module', () => {
    index([
      ['src/user.ts', USER],
      ['src/barrel.ts', "export { user_service } from './user';\n"],
      [
        'src/app.ts',
        "import { user_service } from './barrel';\nfunction main() { user_service.create_user(); }\n",
      ],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges[0]?.to_id).toBe('src/user.ts#method:user_service.create_user');
  });

  it('follows a star re-export to the defining module', () => {
    index([
      ['src/user.ts', USER],
      ['src/barrel.ts', "export * from './user';\n"],
      ['src/app.ts', "import { helper } from './barrel';\nfunction main() { helper(); }\n"],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges[0]?.to_id).toBe('src/user.ts#function:helper');
  });

  it('walks member segments after the exported symbol', () => {
    index([
      [
        'src/user.ts',
        'export namespace api {\n  export class user_service {\n    create_user() {}\n  }\n}\n',
      ],
      ['src/app.ts', "import { api } from './user';\nfunction main() { api.user_service.create_user(); }\n"],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges[0]?.to_id).toBe('src/user.ts#method:api.user_service.create_user');
  });

  it('leaves an edge unresolved when no import binds the first segment', () => {
    index([
      ['src/user.ts', USER],
      ['src/app.ts', 'function main() { helper(); }\n'],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges[0]?.to_id).toBeUndefined();
  });

  it('leaves an edge unresolved when the import points outside the project', () => {
    index([['src/app.ts', "import { helper } from 'react';\nfunction main() { helper(); }\n"]]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges[0]?.to_id).toBeUndefined();
  });
});

describe('resolve_project_graph: references and imports', () => {
  it('resolves a bare-name reference through a named import', () => {
    index([
      ['src/user.ts', USER],
      ['src/app.ts', "import { helper } from './user';\nfunction main() { helper(); }\n"],
    ]);

    const helper_uses = store.get_references_to('src/user.ts#function:helper');

    expect(helper_uses.map((ref) => ref.file_path)).toContain('src/app.ts');
  });

  it('resolves the import specifier itself during the pass', () => {
    // The analysis is stored with no file index, so specifiers were not
    // resolved at extraction time; the pass fills them in.
    index([
      ['src/user.ts', USER],
      ['src/app.ts', "import { helper } from './user';\n"],
    ]);

    const imports = store.get_imports_in_file('src/app.ts');
    expect(imports[0]?.resolved_path).toBe('src/user.ts');
  });
});

describe('resolve_project_graph: large inputs', () => {
  it('resolves thousands of uses of one import binding', () => {
    const count = 6_000;
    const body = Array.from({ length: count }, () => '  helper();').join('\n');
    index([
      ['src/user.ts', USER],
      ['src/app.ts', `import { helper } from './user';\nfunction main() {\n${body}\n}\n`],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));
    const uses = store
      .get_references_to('src/user.ts#function:helper')
      .filter((ref) => ref.file_path === 'src/app.ts' && !ref.is_definition);

    expect(edges).toHaveLength(count);
    expect(edges.every((edge) => edge.to_id === 'src/user.ts#function:helper')).toBe(true);
    // The import binding itself is also a use of the name.
    expect(uses.length).toBeGreaterThanOrEqual(count);
  });

  it('resolves across more import bindings than fit in one page', () => {
    // The pass walks import bindings 2,000 at a time.
    const count = 2_100;
    const modules: Array<readonly [string, string]> = [];
    const lines: string[] = [];
    const calls_made: string[] = [];
    for (let index = 0; index < count; index += 1) {
      modules.push([`src/m${index}.ts`, `export function f${index}() {}\n`]);
      lines.push(`import { f${index} } from './m${index}';`);
      calls_made.push(`  f${index}();`);
    }
    index([
      ...modules,
      ['src/app.ts', `${lines.join('\n')}\nfunction main() {\n${calls_made.join('\n')}\n}\n`],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const edges = calls(store.get_relationships_from(app_symbol!.id));

    expect(edges).toHaveLength(count);
    expect(
      edges.every((edge) => edge.to_id === `src/m${edge.to_name.slice(1)}.ts#function:${edge.to_name}`),
    ).toBe(true);
    expect(
      store.get_references_to(`src/m${count - 1}.ts#function:f${count - 1}`).map((ref) => ref.file_path),
    ).toContain('src/app.ts');
  });

  it('leaves names that are not imported unresolved without reading them', () => {
    index([
      ['src/user.ts', USER],
      ['src/app.ts', 'function main() { helper(); local(); }\nfunction local() {}\n'],
    ]);

    const app_symbol = store.find_symbols_by_name('main')[0];
    const helper_call = calls(store.get_relationships_from(app_symbol!.id)).find(
      (edge) => edge.to_name === 'helper',
    );

    expect(helper_call?.to_id).toBeUndefined();
  });
});

describe('resolve_project_graph: typed receivers', () => {
  it('resolves a method call on a parameter typed with an imported class', () => {
    index([
      ['src/user.ts', USER],
      [
        'src/routes.ts',
        "import { user_service } from './user';\nexport function routes(service: user_service) { service.create_user(); }\n",
      ],
    ]);

    const routes = store.find_symbols_by_name('routes')[0];
    const edge = calls(store.get_relationships_from(routes!.id)).find(
      (e) => e.to_name === 'service.create_user',
    );

    expect(edge?.to_id).toBe('src/user.ts#method:user_service.create_user');
    expect(edge?.confidence).toBe('resolved');
  });

  it('resolves a call through a constructor parameter property', () => {
    index([
      ['src/user.ts', USER],
      [
        'src/app.ts',
        "import { user_service } from './user';\nexport class app {\n  constructor(private readonly users: user_service) {}\n  start() { this.users.create_user(); }\n}\n",
      ],
    ]);

    const start = store.find_symbols_by_name('start')[0];
    const edge = calls(store.get_relationships_from(start!.id))[0];

    expect(edge?.to_id).toBe('src/user.ts#method:user_service.create_user');
  });

  it('does not follow an import the typed receiver shadows', () => {
    // `user_service` is imported, but here it names a local parameter typed
    // with a type that is not imported, so nothing may resolve.
    index([
      ['src/user.ts', USER],
      [
        'src/app.ts',
        "import { user_service } from './user';\nexport function main(user_service: other_type) { user_service.create_user(); }\n",
      ],
    ]);

    const main = store.find_symbols_by_name('main')[0];
    const edge = calls(store.get_relationships_from(main!.id))[0];

    expect(edge?.to_id).toBeUndefined();
  });
});
