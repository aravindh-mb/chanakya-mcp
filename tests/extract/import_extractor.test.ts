import { describe, expect, it } from 'vitest';
import { extract_imports } from '../../src/extract/import_extractor.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { code_import, import_kind } from '../../src/model/module_graph.js';

function extract(
  source: string,
  relative_path = 'src/a.ts',
  files?: ReadonlySet<string>,
): readonly code_import[] {
  const parsed = parse_source({ source, file_path: relative_path });
  return extract_imports(
    files === undefined ? { parsed, relative_path } : { parsed, relative_path, files },
  );
}

function summarize(imports: readonly code_import[]): Array<[import_kind, string | undefined, string | undefined, string]> {
  return imports.map((item) => [
    item.kind,
    item.imported_name,
    item.local_name,
    item.module_specifier,
  ]);
}

describe('extract_imports: static forms', () => {
  it('extracts a named import', () => {
    expect(summarize(extract("import { create_user } from './user';"))).toEqual([
      ['named', 'create_user', 'create_user', './user'],
    ]);
  });

  it('extracts an aliased named import', () => {
    expect(summarize(extract("import { create_user as make } from './user';"))).toEqual([
      ['named', 'create_user', 'make', './user'],
    ]);
  });

  it('extracts several names in one statement', () => {
    expect(summarize(extract("import { a, b as c } from './m';"))).toEqual([
      ['named', 'a', 'a', './m'],
      ['named', 'b', 'c', './m'],
    ]);
  });

  it('extracts a default import', () => {
    expect(summarize(extract("import app from './app';"))).toEqual([
      ['default', 'default', 'app', './app'],
    ]);
  });

  it('extracts a namespace import', () => {
    expect(summarize(extract("import * as utils from './utils';"))).toEqual([
      ['namespace', undefined, 'utils', './utils'],
    ]);
  });

  it('extracts a side-effect import with no binding', () => {
    expect(summarize(extract("import './polyfill';"))).toEqual([
      ['side_effect', undefined, undefined, './polyfill'],
    ]);
  });

  it('extracts a default import with a named clause together', () => {
    expect(summarize(extract("import app, { helper } from './m';"))).toEqual([
      ['default', 'default', 'app', './m'],
      ['named', 'helper', 'helper', './m'],
    ]);
  });
});

describe('extract_imports: dynamic forms', () => {
  it('extracts a require() binding', () => {
    expect(summarize(extract("const util = require('./util');"))).toEqual([
      ['require', undefined, 'util', './util'],
    ]);
  });

  it('records a require() that is not a binding as a dependency', () => {
    expect(summarize(extract("consume(require('./m'));"))).toEqual([
      ['require', undefined, undefined, './m'],
    ]);
  });

  it('extracts a dynamic import with a string specifier', () => {
    expect(summarize(extract("const mod = await import('./lazy');"))).toEqual([
      ['dynamic', undefined, undefined, './lazy'],
    ]);
  });

  it('ignores a dynamic import with a non-string argument', () => {
    expect(extract(`import(path);`)).toEqual([]);
  });
});

describe('extract_imports: resolution', () => {
  it('resolves a relative specifier against the given files', () => {
    const imports = extract("import { a } from './m';", 'src/a.ts', new Set(['src/m.ts', 'src/a.ts']));

    expect(imports[0]?.resolved_path).toBe('src/m.ts');
    expect(imports[0]?.is_internal).toBe(true);
  });

  it('probes extensions for an extensionless specifier', () => {
    const imports = extract("import { a } from './util';", 'src/a.ts', new Set(['src/util.ts', 'src/a.ts']));

    expect(imports[0]?.resolved_path).toBe('src/util.ts');
  });

  it('resolves an index file', () => {
    const imports = extract(
      "import { a } from './lib';",
      'src/a.ts',
      new Set(['src/lib/index.ts', 'src/a.ts']),
    );

    expect(imports[0]?.resolved_path).toBe('src/lib/index.ts');
  });

  it('leaves bare package specifiers unresolved but marked external', () => {
    const imports = extract("import { a } from 'react';", 'src/a.ts', new Set(['src/a.ts']));

    expect(imports[0]?.resolved_path).toBeUndefined();
    expect(imports[0]?.is_internal).toBe(false);
  });

  it('leaves unresolvable relative specifiers unresolved', () => {
    const imports = extract("import { a } from './missing';", 'src/a.ts', new Set(['src/a.ts']));

    expect(imports[0]?.resolved_path).toBeUndefined();
    expect(imports[0]?.is_internal).toBe(true);
  });

  it('records no resolved path when no file set is given', () => {
    const imports = extract("import { a } from './m';");

    expect(imports[0]?.resolved_path).toBeUndefined();
  });
});
