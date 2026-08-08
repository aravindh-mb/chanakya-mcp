import { describe, expect, it } from 'vitest';
import { build_symbol_id, is_symbol_kind, SYMBOL_KINDS } from '../../src/model/symbol.js';

describe('build_symbol_id', () => {
  it('builds a readable id from file, kind and container path', () => {
    const id = build_symbol_id({
      file_path: 'src/user.ts',
      kind: 'method',
      container_path: ['user_service', 'create_user'],
    });

    expect(id).toBe('src/user.ts#method:user_service.create_user');
  });

  it('handles a top-level symbol', () => {
    expect(build_symbol_id({ file_path: 'src/a.ts', kind: 'function', container_path: ['foo'] })).toBe(
      'src/a.ts#function:foo',
    );
  });

  it('is stable when unrelated code moves', () => {
    // The whole point: no line numbers, so editing code above a symbol does not
    // change its id, which is what lets phase 7 diff a file instead of
    // replacing every row in it.
    const first = build_symbol_id({ file_path: 'src/a.ts', kind: 'function', container_path: ['foo'] });
    const second = build_symbol_id({ file_path: 'src/a.ts', kind: 'function', container_path: ['foo'] });

    expect(first).toBe(second);
    expect(first).not.toMatch(/\d+$/);
  });

  it('distinguishes symbols that differ only by kind', () => {
    const as_interface = build_symbol_id({ file_path: 'a.ts', kind: 'interface', container_path: ['user'] });
    const as_class = build_symbol_id({ file_path: 'a.ts', kind: 'class', container_path: ['user'] });

    // TypeScript allows an interface and a class with the same name in one file.
    expect(as_interface).not.toBe(as_class);
  });

  it('distinguishes the same name in different files', () => {
    const first = build_symbol_id({ file_path: 'a.ts', kind: 'function', container_path: ['run'] });
    const second = build_symbol_id({ file_path: 'b.ts', kind: 'function', container_path: ['run'] });

    expect(first).not.toBe(second);
  });

  it('distinguishes a method from a same-named top-level function', () => {
    const method = build_symbol_id({ file_path: 'a.ts', kind: 'method', container_path: ['svc', 'run'] });
    const fn = build_symbol_id({ file_path: 'a.ts', kind: 'function', container_path: ['run'] });

    expect(method).not.toBe(fn);
  });

  it('appends a disambiguator only when one is given', () => {
    const plain = build_symbol_id({ file_path: 'a.ts', kind: 'function', container_path: ['f'] });
    const disambiguated = build_symbol_id({
      file_path: 'a.ts',
      kind: 'function',
      container_path: ['f'],
      disambiguator: 2,
    });

    expect(plain).not.toContain('~');
    expect(disambiguated).toBe(`${plain}~2`);
  });
});

describe('is_symbol_kind', () => {
  it('accepts every declared kind', () => {
    for (const kind of SYMBOL_KINDS) {
      expect(is_symbol_kind(kind)).toBe(true);
    }
  });

  it('rejects unknown and non-string values', () => {
    expect(is_symbol_kind('struct')).toBe(false);
    expect(is_symbol_kind('')).toBe(false);
    expect(is_symbol_kind(undefined)).toBe(false);
    expect(is_symbol_kind(null)).toBe(false);
    expect(is_symbol_kind(7)).toBe(false);
    expect(is_symbol_kind({ kind: 'function' })).toBe(false);
  });

  it('covers the kinds the specification requires', () => {
    expect([...SYMBOL_KINDS].sort()).toEqual(
      ['class', 'constant', 'enum', 'function', 'interface', 'method', 'module', 'type', 'variable'].sort(),
    );
  });
});
