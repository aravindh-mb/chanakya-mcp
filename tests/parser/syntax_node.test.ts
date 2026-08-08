import { describe, expect, it } from 'vitest';
import { parse_source } from '../../src/parser/parse_file.js';
import type { syntax_node } from '../../src/parser/types.js';

function parse(source: string) {
  return parse_source({ source, file_path: 'a.ts' });
}

function find_first(root: syntax_node, type: string): syntax_node {
  for (const node of root.walk()) {
    if (node.type === type) {
      return node;
    }
  }
  throw new Error(`no ${type} node found`);
}

describe('syntax_node navigation', () => {
  it('separates named children from punctuation', () => {
    const { root } = parse('const a = 1;');
    const declaration = find_first(root, 'variable_declarator');

    expect(declaration.named_children.every((child) => child.is_named)).toBe(true);
    expect(declaration.children.length).toBeGreaterThan(declaration.named_children.length);
  });

  it('resolves grammar fields by name', () => {
    const { root } = parse('function target_name() {}');
    const declaration = find_first(root, 'function_declaration');

    expect(declaration.child_by_field('name')?.text).toBe('target_name');
    expect(declaration.child_by_field('body')?.type).toBe('statement_block');
  });

  it('returns undefined for a field that is absent', () => {
    const { root } = parse('const a = 1;');

    expect(find_first(root, 'variable_declarator').child_by_field('nonexistent')).toBeUndefined();
  });

  it('links a child back to its parent', () => {
    const { root } = parse('class c { m() {} }');
    const body = find_first(root, 'class_body');

    expect(body.parent?.type).toBe('class_declaration');
  });

  it('leaves the root without a parent', () => {
    expect(parse('const a = 1;').root.parent).toBeUndefined();
  });

  it('walks depth-first in pre-order, starting with itself', () => {
    const { root } = parse('const a = 1;');
    const types = [...root.walk()].map((node) => node.type);

    expect(types[0]).toBe('program');
    expect(types).toContain('lexical_declaration');
    expect(types.indexOf('lexical_declaration')).toBeLessThan(types.indexOf('variable_declarator'));
  });

  it('finds nested symbols at any depth', () => {
    const { root } = parse(`
      class outer {
        method_one() {
          function inner_function() {}
        }
      }
    `);
    const names = [...root.walk()]
      .filter((node) => node.type === 'function_declaration' || node.type === 'method_definition')
      .map((node) => node.child_by_field('name')?.text);

    expect(names).toEqual(['method_one', 'inner_function']);
  });

  it('does not overflow the stack on deeply nested source', () => {
    // Recursion would blow the stack here; the walk uses an explicit stack.
    const depth = 2000;
    const { root } = parse('('.repeat(depth) + '1' + ')'.repeat(depth));

    expect(() => [...root.walk()].length).not.toThrow();
  });
});

describe('syntax_node metadata', () => {
  it('marks error nodes', () => {
    const { root } = parse('function broken( {');

    expect(root.has_error).toBe(true);
  });

  it('reports a clean tree as error free', () => {
    expect(parse('const a = 1;').root.has_error).toBe(false);
  });

  it('marks nodes the parser inserted for recovery', () => {
    // An unclosed brace is recovered by inserting a MISSING "}" node rather
    // than producing an ERROR node, so is_missing is the only signal here.
    const { root } = parse('if (a) { b();');
    const missing = [...root.walk()].filter((node) => node.is_missing);

    expect(missing.map((node) => node.type)).toContain('}');
  });

  it('memoizes wrapped children so identity is stable', () => {
    const { root } = parse('const a = 1;');

    expect(root.children[0]).toBe(root.children[0]);
  });

  it('memoizes the range', () => {
    const { root } = parse('const a = 1;');

    expect(root.range).toBe(root.range);
  });
});
