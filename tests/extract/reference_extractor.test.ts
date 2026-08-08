import { describe, expect, it } from 'vitest';
import { extract_references } from '../../src/extract/reference_extractor.js';
import { extract_symbols } from '../../src/extract/symbol_extractor.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { code_reference } from '../../src/model/module_graph.js';

function extract(source: string, relative_path = 'src/a.ts'): {
  readonly refs: readonly code_reference[];
  readonly symbol_name_by_id: ReadonlyMap<string, string>;
  readonly enclosing_name_by_id: ReadonlyMap<string, string>;
} {
  const parsed = parse_source({ source, file_path: relative_path });
  const { symbols } = extract_symbols({ parsed, relative_path });
  const symbol_name_by_id = new Map(symbols.map((symbol) => [symbol.id, symbol.name]));

  return {
    refs: extract_references({ parsed, relative_path, symbols }),
    symbol_name_by_id,
    enclosing_name_by_id: symbol_name_by_id,
  };
}

function names(refs: readonly code_reference[]): string[] {
  return refs.map((ref) => ref.name);
}

function by_name(
  refs: readonly code_reference[],
  name: string,
  is_definition: boolean,
): code_reference {
  const found = refs.find((ref) => ref.name === name && ref.is_definition === is_definition);
  if (found === undefined) {
    throw new Error(`no ${is_definition ? 'definition' : 'use'} reference named ${name}`);
  }
  return found;
}

describe('extract_references: definitions', () => {
  it('records the definition of a top-level function', () => {
    const { refs, symbol_name_by_id } = extract('function foo() {}');
    const def = by_name(refs, 'foo', true);

    expect(def.symbol_id).toBeDefined();
    expect(symbol_name_by_id.get(def.symbol_id!)).toBe('foo');
    expect(def.is_definition).toBe(true);
  });

  it('records the definition of a class and its methods', () => {
    const { refs } = extract('class a { m() {} }');

    expect(names(refs).sort()).toEqual(['a', 'm']);
    expect(by_name(refs, 'a', true).symbol_id).toBeDefined();
    expect(by_name(refs, 'm', true).symbol_id).toBeDefined();
  });

  it('records the definition of a nested function', () => {
    const { refs } = extract('function outer() { function inner() {} }');

    expect(by_name(refs, 'inner', true).symbol_id).toBeDefined();
    // The definition sits inside the inner function's own scope.
    expect(by_name(refs, 'inner', true).enclosing_symbol_id).toBe(
      by_name(refs, 'inner', true).symbol_id,
    );
  });

  it('skips parameters, which are not indexed symbols', () => {
    const { refs } = extract('function f(x: number) { x(); }');

    expect(refs.some((ref) => ref.name === 'x' && ref.is_definition)).toBe(false);
    // The use stays visible, honestly unresolved.
    expect(refs.some((ref) => ref.name === 'x' && !ref.is_definition)).toBe(true);
  });

  it('skips import and export specifiers', () => {
    const { refs } = extract("import { a } from './m'; export { a };");

    expect(names(refs)).not.toContain('a');
  });

  it('skips object literal keys but records shorthand uses', () => {
    const { refs } = extract('const o = { key: 1, other };');

    expect(names(refs)).not.toContain('key');
    const shorthand = refs.find((ref) => ref.name === 'other');
    expect(shorthand).toBeDefined();
    expect(shorthand?.symbol_id).toBeUndefined();
  });

  it('skips interface property names but records the type used in annotations', () => {
    const { refs } = extract('interface user { name: user_id }');

    expect(names(refs).filter((name) => name === 'name')).toEqual([]);
    expect(names(refs)).toContain('user_id');
  });
});

describe('extract_references: uses and resolution', () => {
  it('resolves a bare use to a unique top-level symbol', () => {
    const { refs, symbol_name_by_id } = extract('function foo() {} function bar() { foo(); }');
    const use = by_name(refs, 'foo', false);

    expect(symbol_name_by_id.get(use.symbol_id!)).toBe('foo');
  });

  it('attributes a use to the symbol that encloses it', () => {
    const { refs, enclosing_name_by_id } = extract('function foo() {} function bar() { foo(); }');
    const use = by_name(refs, 'foo', false);

    expect(enclosing_name_by_id.get(use.enclosing_symbol_id!)).toBe('bar');
  });

  it('resolves a this.member use inside a method', () => {
    const { refs, symbol_name_by_id } = extract('class a { m() { this.n(); } n() {} }');
    const member_use = refs.find((ref) => ref.name === 'n' && !ref.is_definition);

    expect(member_use).toBeDefined();
    expect(symbol_name_by_id.get(member_use!.symbol_id!)).toBe('n');
  });

  it('resolves a type reference to the named type', () => {
    const { refs, symbol_name_by_id } = extract('interface user {} function f(u: user): user { return u; }');
    const type_uses = refs.filter((ref) => ref.name === 'user' && !ref.is_definition);

    expect(type_uses.length).toBeGreaterThanOrEqual(2);
    for (const use of type_uses) {
      expect(symbol_name_by_id.get(use.symbol_id!)).toBe('user');
    }
  });

  it('leaves a call to an imported binding unresolved, for the graph pass', () => {
    const { refs } = extract("import { helper } from './m'; function f() { helper(); }");
    const use = by_name(refs, 'helper', false);

    expect(use.symbol_id).toBeUndefined();
  });

  it('leaves a member use on an imported binding unresolved', () => {
    const { refs } = extract("import { svc } from './m'; function f() { svc.create_user(); }");
    const member_use = refs.find((ref) => ref.name === 'create_user');

    expect(member_use).toBeDefined();
    expect(member_use!.symbol_id).toBeUndefined();
  });

  it('keeps two same-named declarations from resolving a bare use', () => {
    const { refs } = extract('function f() {} function f() {} function g() { f(); }');
    const use = by_name(refs, 'f', false);

    expect(use.symbol_id).toBeUndefined();
  });
});
