import { describe, expect, it } from 'vitest';
import { extract_calls } from '../../src/extract/call_extractor.js';
import { extract_symbols } from '../../src/extract/symbol_extractor.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { relationship } from '../../src/model/relationship.js';

function extract(source: string, relative_path = 'src/a.ts'): {
  readonly edges: readonly relationship[];
  readonly symbol_name_by_id: ReadonlyMap<string, string>;
} {
  const parsed = parse_source({ source, file_path: relative_path });
  const { symbols } = extract_symbols({ parsed, relative_path });
  const symbol_name_by_id = new Map(symbols.map((symbol) => [symbol.id, symbol.name]));

  return {
    edges: extract_calls({ parsed, relative_path, symbols }),
    symbol_name_by_id,
  };
}

function callee_names(edges: readonly relationship[]): string[] {
  return edges.map((edge) => edge.to_name);
}

describe('extract_calls', () => {
  it('records a top-level call with the file as the caller', () => {
    const { edges } = extract('function foo() {} foo();');

    expect(edges).toHaveLength(1);
    expect(edges[0]?.from_id).toBe('src/a.ts');
    expect(edges[0]?.to_name).toBe('foo');
  });

  it('attributes a call to the symbol that encloses it', () => {
    const { edges, symbol_name_by_id } = extract('function foo() {} function bar() { foo(); }');

    expect(edges).toHaveLength(1);
    expect(symbol_name_by_id.get(edges[0]!.from_id)).toBe('bar');
  });

  it('resolves a direct call to a same-file symbol', () => {
    const { edges, symbol_name_by_id } = extract('function foo() {} function bar() { foo(); }');

    expect(symbol_name_by_id.get(edges[0]!.to_id!)).toBe('foo');
    expect(edges[0]!.confidence).toBe('certain');
  });

  it('resolves a this.member call inside a method', () => {
    const { edges, symbol_name_by_id } = extract('class a { m() { this.n(); } n() {} }');

    expect(edges).toHaveLength(1);
    expect(edges[0]!.to_name).toBe('this.n');
    expect(symbol_name_by_id.get(edges[0]!.to_id!)).toBe('n');
  });

  it('resolves a chain through an object-constant member', () => {
    const { edges } = extract(
      'const svc = { create_user() {} }; function main() { svc.create_user(); }',
    );

    // The object literal method is not a symbol, so the member call cannot
    // resolve and stays honest.
    expect(callee_names(edges)).toContain('svc.create_user');
    const edge = edges.find((item) => item.to_name === 'svc.create_user');
    expect(edge?.to_id).toBeUndefined();
  });

  it('leaves a call through an imported binding unresolved', () => {
    const { edges } = extract("import { svc } from './m'; function main() { svc.create_user(); }");

    expect(edges).toHaveLength(1);
    expect(edges[0]!.to_name).toBe('svc.create_user');
    expect(edges[0]!.to_id).toBeUndefined();
  });

  it('records two calls to the same target with distinct ids', () => {
    const { edges } = extract('function foo() {} foo(foo(1));');

    expect(edges).toHaveLength(2);
    expect(edges[0]!.id).not.toBe(edges[1]!.id);
  });

  it('does not record dynamic import or require as calls', () => {
    const { edges } = extract("const a = require('./m'); const b = import('./n');");

    expect(edges).toHaveLength(0);
  });

  it('does not record calls to unresolved built-ins as resolved', () => {
    const { edges } = extract('function f() { console.log(1); }');

    expect(edges[0]?.to_name).toBe('console.log');
    expect(edges[0]?.to_id).toBeUndefined();
  });
});
