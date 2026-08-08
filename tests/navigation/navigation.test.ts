import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extract_file } from '../../src/extract/extract_file.js';
import { resolve_project_graph } from '../../src/indexer/resolve_project_graph.js';
import { find_callees, find_callers, find_definition, find_references } from '../../src/navigation/navigation.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { file_analysis } from '../../src/model/file.js';
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

const USER = `export class user_service {
  create_user() {}
}
export function helper() {}
`;

const APP = `import { user_service, helper } from './user';

function main() {
  helper();
  user_service.create_user();
}

main();
`;

function index(): void {
  store.transaction(() => {
    store.write_file_analysis(analysis_for('src/user.ts', USER));
    store.write_file_analysis(analysis_for('src/app.ts', APP));
  });
  resolve_project_graph({ store });
}

function symbol(name: string): string {
  const found = store.find_symbols_by_name(name);
  if (found.length === 0) {
    throw new Error(`no symbol named ${name}`);
  }
  return found[0]!.id;
}

describe('find_definition', () => {
  it('returns the symbol at its id', () => {
    index();
    const result = find_definition({ store }, symbol('user_service'));

    expect(result.symbol).toBeDefined();
    expect(result.symbol!.file_path).toBe('src/user.ts');
    expect(result.symbol!.name).toBe('user_service');
  });

  it('returns undefined for an unknown id', () => {
    index();
    expect(find_definition({ store }, 'no/such#symbol').symbol).toBeUndefined();
  });
});

describe('find_references', () => {
  it('returns the definition and cross-file uses, definition first', () => {
    index();
    const result = find_references({ store }, symbol('helper'));

    expect(result.references.map((ref) => ref.file_path)).toEqual([
      'src/user.ts',
      'src/app.ts',
    ]);
    expect(result.references[0]?.is_definition).toBe(true);
    expect(result.references[1]?.is_definition).toBe(false);
  });

  it('attributes a cross-file use to its enclosing symbol', () => {
    index();
    const result = find_references({ store }, symbol('helper'));

    expect(result.references[1]?.enclosing_symbol?.name).toBe('main');
  });

  it('resolves an object use of an imported class', () => {
    index();
    const result = find_references({ store }, symbol('user_service'));

    expect(result.references.map((ref) => ref.file_path)).toEqual([
      'src/user.ts',
      'src/app.ts',
    ]);
  });
});

describe('find_callers', () => {
  it('finds the function that calls a symbol', () => {
    index();
    const result = find_callers({ store }, symbol('helper'));

    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]?.caller?.name).toBe('main');
    expect(result.callers[0]?.file_path).toBe('src/app.ts');
    expect(result.callers[0]?.confidence).toBe('resolved');
  });

  it('reports a top-level call with no enclosing caller symbol', () => {
    index();
    const result = find_callers({ store }, symbol('main'));

    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]?.caller).toBeUndefined();
  });
});

describe('find_callees', () => {
  it('finds the symbols a function calls, resolved across files', () => {
    index();
    const result = find_callees({ store }, symbol('main'));

    expect(result.callees.map((hit) => hit.callee?.name).sort()).toEqual([
      'create_user',
      'helper',
    ]);
  });

  it('names a callee even when the edge is unresolved', () => {
    store.transaction(() => {
      store.write_file_analysis(
        analysis_for('src/standalone.ts', 'function main() { mystery(); }\n'),
      );
    });
    resolve_project_graph({ store });

    const main_id = store.find_symbols_by_name('main').find((s) => s.file_path === 'src/standalone.ts')!.id;
    const result = find_callees({ store }, main_id);

    expect(result.callees[0]?.callee_name).toBe('mystery');
    expect(result.callees[0]?.callee).toBeUndefined();
  });
});
