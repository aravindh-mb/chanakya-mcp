import { describe, expect, it } from 'vitest';
import { extract_exports } from '../../src/extract/export_extractor.js';
import { extract_symbols } from '../../src/extract/symbol_extractor.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { export_kind_detail } from '../../src/model/module_graph.js';

interface export_snapshot {
  readonly kind: export_kind_detail;
  readonly exported_name: string;
  readonly local_name: string | undefined;
  readonly symbol_name: string | undefined;
  readonly module_specifier: string | undefined;
}

function extract(source: string, relative_path = 'src/a.ts'): readonly export_snapshot[] {
  const parsed = parse_source({ source, file_path: relative_path });
  const { symbols } = extract_symbols({ parsed, relative_path });
  const symbol_name_by_id = new Map(symbols.map((symbol) => [symbol.id, symbol.name]));

  return extract_exports({ parsed, relative_path, symbols }).map((item) => ({
    kind: item.kind,
    exported_name: item.exported_name,
    local_name: item.local_name,
    symbol_name: item.symbol_id === undefined ? undefined : symbol_name_by_id.get(item.symbol_id),
    module_specifier: item.module_specifier,
  }));
}

describe('extract_exports: declared exports', () => {
  it('exports a named const declaration', () => {
    expect(extract('export const a = 1;')).toEqual([
      {
        kind: 'named',
        exported_name: 'a',
        local_name: 'a',
        symbol_name: 'a',
        module_specifier: undefined,
      },
    ]);
  });

  it('exports a class declaration', () => {
    expect(extract('export class user_service {}')).toEqual([
      {
        kind: 'named',
        exported_name: 'user_service',
        local_name: 'user_service',
        symbol_name: 'user_service',
        module_specifier: undefined,
      },
    ]);
  });

  it('exports several declarators under one statement', () => {
    const exports = extract('export const a = 1, b = 2;');

    expect(exports.map((item) => item.exported_name)).toEqual(['a', 'b']);
  });

  it('exports a named function and an interface', () => {
    const exports = extract('export function run() {} export interface user {}');

    expect(exports.map((item) => [item.kind, item.exported_name])).toEqual([
      ['named', 'run'],
      ['named', 'user'],
    ]);
  });
});

describe('extract_exports: export lists', () => {
  it('exports a named list', () => {
    const exports = extract('const a = 1; const b = 2; export { a, b };');

    expect(exports.map((item) => [item.exported_name, item.symbol_name])).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ]);
  });

  it('exports an alias', () => {
    const exports = extract('const a = 1; export { a as b };');

    expect(exports[0]).toMatchObject({ exported_name: 'b', local_name: 'a', symbol_name: 'a' });
  });

  it('re-exports a named list from another module', () => {
    expect(extract("export { a } from './m';")[0]).toEqual({
      kind: 're_export',
      exported_name: 'a',
      local_name: 'a',
      symbol_name: undefined,
      module_specifier: './m',
    });
  });

  it('re-exports everything from another module', () => {
    expect(extract("export * from './m';")[0]).toEqual({
      kind: 're_export',
      exported_name: '*',
      local_name: undefined,
      symbol_name: undefined,
      module_specifier: './m',
    });
  });
});

describe('extract_exports: default exports', () => {
  it('exports a named default class as default', () => {
    expect(extract('export default class user {}')).toEqual([
      {
        kind: 'default',
        exported_name: 'default',
        local_name: 'user',
        symbol_name: 'user',
        module_specifier: undefined,
      },
    ]);
  });

  it('exports an anonymous default function, pointing at the default symbol', () => {
    const exports = extract('export default function () {}');

    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({
      kind: 'default',
      exported_name: 'default',
      local_name: undefined,
      symbol_name: 'default',
    });
  });

  it('exports a plain default value with no symbol', () => {
    expect(extract('export default 42;')).toEqual([
      {
        kind: 'default',
        exported_name: 'default',
        local_name: undefined,
        symbol_name: undefined,
        module_specifier: undefined,
      },
    ]);
  });
});
