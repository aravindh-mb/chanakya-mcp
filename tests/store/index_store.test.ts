import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hash_content } from '../../src/core/hash.js';
import type { file_analysis } from '../../src/model/file.js';
import { index_store } from '../../src/store/index_store.js';
import { METADATA_KEYS, SCHEMA_VERSION } from '../../src/store/schema.js';

let store: index_store;

beforeEach(() => {
  store = index_store.open({
    data_dir_path: '',
    project_root: '/project',
    in_memory: true,
    tool_version: '9.9.9',
  });
});

afterEach(() => {
  store.close();
});

function make_analysis(overrides: Partial<file_analysis> = {}): file_analysis {
  return {
    file: {
      file_path: 'src/user.ts',
      absolute_path: '/project/src/user.ts',
      language: 'typescript',
      size: 100,
      modified_time: 1_700_000_000_000,
      content_hash: hash_content('export class user_service {}'),
      parse_error_count: 0,
    },
    symbols: [
      {
        id: 'src/user.ts#class:user_service',
        name: 'user_service',
        kind: 'class',
        file_path: 'src/user.ts',
        language: 'typescript',
        start_line: 1,
        end_line: 3,
        start_column: 1,
        end_column: 2,
        parent_id: undefined,
        signature: 'class user_service',
        export_kind: 'named',
        is_ambient: false,
      },
      {
        id: 'src/user.ts#method:user_service.create_user',
        name: 'create_user',
        kind: 'method',
        file_path: 'src/user.ts',
        language: 'typescript',
        start_line: 2,
        end_line: 2,
        start_column: 3,
        end_column: 20,
        parent_id: 'src/user.ts#class:user_service',
        signature: 'create_user(): void',
        export_kind: 'none',
        is_ambient: false,
      },
    ],
    relationships: [
      {
        id: 'edge-1',
        kind: 'contains',
        from_id: 'src/user.ts#class:user_service',
        to_id: 'src/user.ts#method:user_service.create_user',
        to_name: 'create_user',
        confidence: 'certain',
        file_path: 'src/user.ts',
        line: 2,
      },
    ],
    imports: [
      {
        id: 'import-1',
        file_path: 'src/user.ts',
        kind: 'named',
        module_specifier: './db',
        imported_name: 'db',
        local_name: 'db',
        resolved_path: 'src/db.ts',
        is_internal: true,
        line: 1,
      },
    ],
    exports: [
      {
        id: 'export-1',
        file_path: 'src/user.ts',
        kind: 'named',
        exported_name: 'user_service',
        local_name: 'user_service',
        symbol_id: 'src/user.ts#class:user_service',
        module_specifier: undefined,
        line: 1,
      },
    ],
    references: [
      {
        id: 'ref-1',
        file_path: 'src/user.ts',
        name: 'create_user',
        symbol_id: 'src/user.ts#method:user_service.create_user',
        enclosing_symbol_id: 'src/user.ts#class:user_service',
        line: 2,
        column: 3,
        is_definition: true,
      },
    ],
    ...overrides,
  };
}

describe('index_store schema', () => {
  it('records the schema version', () => {
    expect(store.get_metadata(METADATA_KEYS.schema_version)).toBe(String(SCHEMA_VERSION));
  });

  it('records the project root and tool version', () => {
    expect(store.get_metadata(METADATA_KEYS.project_root)).toBe('/project');
    expect(store.get_metadata(METADATA_KEYS.tool_version)).toBe('9.9.9');
  });

  it('starts empty', () => {
    expect(store.count()).toEqual({
      files: 0,
      symbols: 0,
      relationships: 0,
      references: 0,
      imports: 0,
      exports: 0,
    });
  });

  it('returns undefined for unknown metadata', () => {
    expect(store.get_metadata('nope')).toBeUndefined();
  });
});

describe('index_store writing', () => {
  it('writes every part of a file analysis', () => {
    store.write_file_analysis(make_analysis());

    expect(store.count()).toEqual({
      files: 1,
      symbols: 2,
      relationships: 1,
      references: 1,
      imports: 1,
      exports: 1,
    });
  });

  it('round-trips a file record', () => {
    const analysis = make_analysis();
    store.write_file_analysis(analysis);

    expect(store.get_file('src/user.ts')).toEqual(analysis.file);
  });

  it('round-trips a symbol, preserving undefined for absent fields', () => {
    store.write_file_analysis(make_analysis());
    const symbol = store.get_symbol('src/user.ts#class:user_service');

    expect(symbol?.name).toBe('user_service');
    expect(symbol?.kind).toBe('class');
    // NULL in SQL must come back as undefined, not null: the model says
    // "not known", and null would leak the storage representation.
    expect(symbol?.parent_id).toBeUndefined();
    expect(symbol?.is_ambient).toBe(false);
  });

  it('round-trips booleans correctly', () => {
    const analysis = make_analysis();
    const ambient = { ...analysis.symbols[0]!, id: 'ambient', is_ambient: true };
    store.write_file_analysis({ ...analysis, symbols: [...analysis.symbols, ambient] });

    expect(store.get_symbol('ambient')?.is_ambient).toBe(true);
    expect(store.get_symbol('src/user.ts#class:user_service')?.is_ambient).toBe(false);
  });

  it('round-trips relationships including a resolved target', () => {
    store.write_file_analysis(make_analysis());
    const edges = store.get_relationships_from('src/user.ts#class:user_service');

    expect(edges).toHaveLength(1);
    expect(edges[0]?.kind).toBe('contains');
    expect(edges[0]?.to_id).toBe('src/user.ts#method:user_service.create_user');
    expect(edges[0]?.confidence).toBe('certain');
  });

  it('round-trips an unresolved relationship as undefined, not null', () => {
    const analysis = make_analysis();
    store.write_file_analysis({
      ...analysis,
      relationships: [{ ...analysis.relationships[0]!, id: 'e2', to_id: undefined, to_name: 'mystery' }],
    });

    const edges = store.get_relationships_from('src/user.ts#class:user_service');
    expect(edges[0]?.to_id).toBeUndefined();
    expect(edges[0]?.to_name).toBe('mystery');
  });

  it('round-trips imports and exports', () => {
    store.write_file_analysis(make_analysis());

    expect(store.get_imports_in_file('src/user.ts')[0]?.module_specifier).toBe('./db');
    expect(store.get_imports_in_file('src/user.ts')[0]?.is_internal).toBe(true);
    expect(store.get_exports_in_file('src/user.ts')[0]?.exported_name).toBe('user_service');
    expect(store.get_exports_in_file('src/user.ts')[0]?.module_specifier).toBeUndefined();
  });

  it('round-trips references from the quoted table', () => {
    store.write_file_analysis(make_analysis());
    const references = store.find_references_by_name('create_user');

    expect(references).toHaveLength(1);
    expect(references[0]?.is_definition).toBe(true);
  });
});

describe('index_store replacing a file', () => {
  it('replaces rather than duplicates on rewrite', () => {
    store.write_file_analysis(make_analysis());
    store.write_file_analysis(make_analysis());

    expect(store.count().files).toBe(1);
    expect(store.count().symbols).toBe(2);
  });

  it('removes symbols that no longer exist in the file', () => {
    const analysis = make_analysis();
    store.write_file_analysis(analysis);
    store.write_file_analysis({ ...analysis, symbols: [analysis.symbols[0]!], relationships: [] });

    expect(store.count().symbols).toBe(1);
    expect(store.get_symbol('src/user.ts#method:user_service.create_user')).toBeUndefined();
  });

  it('cascades deletion to every derived row', () => {
    // The property that makes per-file reindexing safe: no orphans anywhere.
    store.write_file_analysis(make_analysis());
    store.delete_file('src/user.ts');

    expect(store.count()).toEqual({
      files: 0,
      symbols: 0,
      relationships: 0,
      references: 0,
      imports: 0,
      exports: 0,
    });
  });

  it('leaves other files untouched when one is deleted', () => {
    const first = make_analysis();
    const second = make_analysis();
    store.write_file_analysis(first);
    store.write_file_analysis({
      ...second,
      file: { ...second.file, file_path: 'src/other.ts' },
      symbols: [{ ...second.symbols[0]!, id: 'other-symbol', file_path: 'src/other.ts' }],
      relationships: [],
      imports: [],
      exports: [],
      references: [],
    });

    store.delete_file('src/user.ts');

    expect(store.count().files).toBe(1);
    expect(store.get_symbol('other-symbol')).toBeDefined();
  });
});

describe('index_store queries', () => {
  beforeEach(() => {
    store.write_file_analysis(make_analysis());
  });

  it('finds symbols by exact name', () => {
    expect(store.find_symbols_by_name('user_service')).toHaveLength(1);
    expect(store.find_symbols_by_name('nothing_here')).toEqual([]);
  });

  it('respects the result limit', () => {
    expect(store.find_symbols_by_name('user_service', 0)).toEqual([]);
  });

  it('lists symbols in a file ordered by position', () => {
    const symbols = store.get_symbols_in_file('src/user.ts');

    expect(symbols.map((symbol) => symbol.name)).toEqual(['user_service', 'create_user']);
  });

  it('returns an empty list for an unknown file', () => {
    expect(store.get_symbols_in_file('src/nope.ts')).toEqual([]);
  });

  it('exposes content hashes for change detection', () => {
    const hashes = store.list_file_hashes();

    expect(hashes.get('src/user.ts')).toBe(hash_content('export class user_service {}'));
    expect(hashes.size).toBe(1);
  });
});

describe('index_store transactions', () => {
  it('rolls back everything when the work throws', () => {
    expect(() =>
      store.transaction(() => {
        store.write_file_analysis(make_analysis());
        throw new Error('boom');
      }),
    ).toThrowError('boom');

    expect(store.count().files).toBe(0);
  });

  it('commits when the work succeeds', () => {
    store.transaction(() => {
      store.write_file_analysis(make_analysis());
    });

    expect(store.count().files).toBe(1);
  });

  it('returns the value the work produced', () => {
    expect(store.transaction(() => 42)).toBe(42);
  });
});
