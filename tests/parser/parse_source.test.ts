import { describe, expect, it } from 'vitest';
import { code_intelligence_error } from '../../src/core/errors.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { syntax_node } from '../../src/parser/types.js';

function parse(source: string, file_path = 'test.ts') {
  return parse_source({ source, file_path });
}

function find_first(root: syntax_node, type: string): syntax_node | undefined {
  for (const node of root.walk()) {
    if (node.type === type) {
      return node;
    }
  }
  return undefined;
}

describe('parse_source language support', () => {
  it('parses JavaScript', () => {
    const result = parse('export function foo(a) { return a + 1; }', 'a.js');

    expect(result.language).toBe('javascript');
    expect(result.root.type).toBe('program');
    expect(result.has_errors).toBe(false);
  });

  it('parses JSX with the JavaScript grammar', () => {
    const result = parse('export const A = () => <div className="x">hi</div>;', 'a.jsx');

    expect(result.language).toBe('jsx');
    expect(result.has_errors).toBe(false);
    expect(find_first(result.root, 'jsx_element')).toBeDefined();
  });

  it('parses TypeScript', () => {
    const result = parse('interface user { id: string }\nclass svc { create(u: user): void {} }', 'a.ts');

    expect(result.language).toBe('typescript');
    expect(result.has_errors).toBe(false);
    expect(find_first(result.root, 'interface_declaration')).toBeDefined();
    expect(find_first(result.root, 'class_declaration')).toBeDefined();
  });

  it('parses TSX', () => {
    const result = parse('export const A = (p: { x: string }) => <div>{p.x}</div>;', 'a.tsx');

    expect(result.language).toBe('tsx');
    expect(result.has_errors).toBe(false);
    expect(find_first(result.root, 'jsx_element')).toBeDefined();
  });

  it.each([
    ['satisfies', 'const x = { a: 1 } satisfies Record<string, number>;'],
    ['accessor fields', 'class c { accessor y = 1; }'],
    ['const type parameters', 'function f<const T extends string>(t: T) { return t; }'],
    ['using declarations', 'using res = get_res();'],
    ['decorators', '@sealed class c {}'],
    ['generics', 'function f<T, U extends keyof T>(t: T, u: U) { return t[u]; }'],
  ])('parses modern TypeScript: %s', (_name, source) => {
    expect(parse(source).has_errors).toBe(false);
  });

  it('parses .mjs and .cjs as JavaScript', () => {
    expect(parse('export default 1;', 'a.mjs').language).toBe('javascript');
    expect(parse('module.exports = {};', 'a.cjs').language).toBe('javascript');
  });

  it('honours an explicit language over the extension', () => {
    const result = parse_source({
      source: 'interface user { id: string }',
      file_path: 'mislabelled.js',
      language: 'typescript',
    });

    expect(result.language).toBe('typescript');
    expect(result.has_errors).toBe(false);
  });

  it('rejects a file whose language cannot be determined', () => {
    expect(() => parse('body { color: red }', 'a.css')).toThrowError(code_intelligence_error);
    expect(() => parse('body { color: red }', 'a.css')).toThrowError(/Cannot determine a supported language/);
  });
});

describe('parse_source error tolerance', () => {
  it('still returns a tree for a file with a syntax error', () => {
    const result = parse('function broken( { const a = 1;', 'a.ts');

    expect(result.root.type).toBe('program');
    expect(result.has_errors).toBe(true);
    expect(result.parse_errors.length).toBeGreaterThan(0);
  });

  it('indexes the parts of a broken file that did parse', () => {
    const result = parse('function ok() {}\nfunction ok_two() {}\nclass !!! {}', 'a.ts');

    expect(result.has_errors).toBe(true);
    const functions = [...result.root.walk()].filter((node) => node.type === 'function_declaration');
    expect(functions).toHaveLength(2);
  });

  it('reports no errors for valid source', () => {
    const result = parse('const a = 1;');

    expect(result.parse_errors).toEqual([]);
    expect(result.has_errors).toBe(false);
  });

  it('locates the error in the file', () => {
    const result = parse('const a = 1;\nconst b = ;\nconst c = 3;');
    const first = result.parse_errors[0];

    expect(first).toBeDefined();
    expect(first?.range.start.line).toBe(2);
  });

  it('caps the number of reported errors', () => {
    const result = parse_source({
      source: '@#$%^ '.repeat(200),
      file_path: 'a.ts',
      max_parse_errors: 5,
    });

    expect(result.parse_errors.length).toBeLessThanOrEqual(5);
  });

  it('reports recovery insertions that produce no ERROR node', () => {
    // `if (a) { b();` is recovered with a MISSING "}" and zero ERROR nodes, so
    // counting only ERROR nodes would silently call this file clean.
    const result = parse('if (a) { b();');

    expect(result.has_errors).toBe(true);
    expect(result.parse_errors.some((error) => error.kind === 'missing')).toBe(true);
    expect(result.parse_errors[0]?.message).toContain('Missing');
  });

  it('distinguishes error nodes from missing nodes', () => {
    const unexpected = parse('const a = 1; ) ;');

    expect(unexpected.parse_errors.some((error) => error.kind === 'error')).toBe(true);
  });

  it('handles an empty file', () => {
    const result = parse('');

    expect(result.root.type).toBe('program');
    expect(result.has_errors).toBe(false);
    expect(result.root.named_children).toEqual([]);
  });

  it('handles a file that is only comments', () => {
    expect(parse('// just a comment\n/* and a block */').has_errors).toBe(false);
  });
});

describe('parse_source positions', () => {
  it('reports 1-based lines and columns', () => {
    const result = parse('const a = 1;\nfunction target() {}');
    const target = find_first(result.root, 'function_declaration');

    // Second line, first column, as an editor would show it.
    expect(target?.range.start.line).toBe(2);
    expect(target?.range.start.column).toBe(1);
  });

  it('reports the end position', () => {
    const result = parse('function f() {}');
    const target = find_first(result.root, 'function_declaration');

    expect(target?.range.end.line).toBe(1);
    expect(target?.range.end.column).toBe(16);
  });

  it('produces indices that slice the source exactly', () => {
    const source = 'const a = 1;\nfunction target() { return 2; }';
    const result = parse_source({ source, file_path: 'a.ts' });
    const target = find_first(result.root, 'function_declaration');

    expect(source.slice(target?.range.start_index, target?.range.end_index)).toBe(
      'function target() { return 2; }',
    );
  });

  it('keeps indices exact for non-ASCII source', () => {
    // Indices are UTF-16 string offsets, not byte offsets. Emoji are surrogate
    // pairs, so a byte-offset assumption would slice mid-character here.
    const source = 'const emoji = "🎉🎉"; const café = 1; function target() {}';
    const result = parse_source({ source, file_path: 'a.ts' });
    const target = find_first(result.root, 'function_declaration');

    expect(source.slice(target?.range.start_index, target?.range.end_index)).toBe('function target() {}');
    expect(target?.text).toBe('function target() {}');
  });

  it('exposes node text matching the source slice', () => {
    const source = 'class user_service {\n  create_user() {}\n}';
    const result = parse_source({ source, file_path: 'a.ts' });
    const method = find_first(result.root, 'method_definition');

    expect(method?.text).toBe('create_user() {}');
  });
});
