import { describe, expect, it } from 'vitest';
import { extract_calls } from '../../src/extract/call_extractor.js';
import { extract_symbols } from '../../src/extract/symbol_extractor.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { relationship } from '../../src/model/relationship.js';

function extract(
  source: string,
  relative_path = 'src/a.ts',
): {
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
    const { edges } = extract('const svc = { create_user() {} }; function main() { svc.create_user(); }');

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

  it('leaves edge ids to the store', () => {
    // The extractor no longer mints ids: the store assigns each row its own
    // key, so identity lives at write time rather than extraction time.
    const { edges } = extract('function foo() {} foo(foo(1));');

    expect(edges).toHaveLength(2);
    expect(edges[0]!.id).toBeUndefined();
    expect(edges[1]!.id).toBeUndefined();
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

describe('extract_calls typed receivers', () => {
  const edge_for = (edges: readonly relationship[], name: string): relationship | undefined =>
    edges.find((edge) => edge.to_name === name);

  it('records the declared type of a parameter receiver', () => {
    const { edges } = extract('function run(service: user_service) { service.create_user(); }');
    expect(edge_for(edges, 'service.create_user')?.receiver_type).toBe('user_service');
  });

  it('records the type of a variable annotated or built with new', () => {
    const { edges } = extract(
      'function run() { const a: user_service = make(); const b = new order_service(); a.go(); b.place(); }',
    );
    expect(edge_for(edges, 'a.go')?.receiver_type).toBe('user_service');
    expect(edge_for(edges, 'b.place')?.receiver_type).toBe('order_service');
  });

  it('uses the base of a generic type', () => {
    const { edges } = extract('function run(repo: repository<user>) { repo.save(); }');
    expect(edge_for(edges, 'repo.save')?.receiver_type).toBe('repository');
  });

  it('records the type of a this-field and a constructor parameter property', () => {
    const { edges } = extract(`class svc {
  private readonly users: user_repository;
  constructor(private readonly orders: order_repository) {}
  run() { this.users.find(); this.orders.list(); }
}`);
    expect(edge_for(edges, 'this.users.find')?.receiver_type).toBe('user_repository');
    expect(edge_for(edges, 'this.orders.list')?.receiver_type).toBe('order_repository');
  });

  it('resolves a typed call to a class declared in the same file', () => {
    const { edges, symbol_name_by_id } = extract(`class user_service { create_user() {} }
function run(service: user_service) { service.create_user(); }`);
    const edge = edge_for(edges, 'service.create_user');
    expect(edge?.to_id).toBeDefined();
    expect(symbol_name_by_id.get(edge!.to_id!)).toBe('create_user');
    expect(edge?.receiver_type).toBeUndefined();
  });

  it('leaves untyped, destructured and inferred receivers alone', () => {
    const { edges } = extract(`function run(plain, { svc }: deps, cb = make()) {
  const made = make();
  plain.go(); svc.go(); made.go(); cb.go();
}`);
    for (const name of ['plain.go', 'svc.go', 'made.go', 'cb.go']) {
      expect(edge_for(edges, name)?.receiver_type).toBeUndefined();
    }
  });

  it('respects shadowing by a nearer untyped declaration', () => {
    const { edges } = extract(`function run(service: user_service) {
  { const service = make(); service.create_user(); }
  for (const service of list) { service.create_user(); }
  try {} catch (service) { service.create_user(); }
}`);
    expect(
      edges
        .filter((edge) => edge.to_name === 'service.create_user')
        .every((edge) => edge.receiver_type === undefined),
    ).toBe(true);
  });

  it('does not treat a use in a loop head as a declaration', () => {
    const { edges } = extract(
      'function run(service: user_service) { for (const x of service.all()) { service.save(x); } }',
    );
    expect(edge_for(edges, 'service.all')?.receiver_type).toBe('user_service');
    expect(edge_for(edges, 'service.save')?.receiver_type).toBe('user_service');
  });

  it('does not follow this into a function or object method that rebinds it', () => {
    const { edges } = extract(`class svc {
  constructor(private readonly orders: order_repository) {}
  run() {
    const arrow = () => this.orders.arrow_call();
    function inner() { this.orders.plain_call(); }
    const object = { method() { this.orders.object_call(); } };
  }
}`);
    expect(edge_for(edges, 'this.orders.arrow_call')?.receiver_type).toBe('order_repository');
    expect(edge_for(edges, 'this.orders.plain_call')?.receiver_type).toBeUndefined();
    expect(edge_for(edges, 'this.orders.object_call')?.receiver_type).toBeUndefined();
  });

  it('ignores union and qualified types', () => {
    const { edges } = extract('function run(a: user_service | null, b: ns.user_service) { a.go(); b.go(); }');
    expect(edge_for(edges, 'a.go')?.receiver_type).toBeUndefined();
    expect(edge_for(edges, 'b.go')?.receiver_type).toBeUndefined();
  });
});
