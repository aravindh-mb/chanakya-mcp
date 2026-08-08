/**
 * Adapter turning tree-sitter nodes into the package's `syntax_node` shape.
 *
 * Two jobs, both done exactly once here so no other module has to think about
 * them:
 *
 * 1. Position conversion. tree-sitter reports 0-based rows and columns; every
 *    layer above uses 1-based lines and columns.
 * 2. Laziness. Children are wrapped on access and memoized, so inspecting a
 *    handful of nodes in a 5,000-line file does not build 5,000 objects.
 */

import type Parser from 'tree-sitter';
import type { source_position, source_range, syntax_node } from './types.js';

function to_position(point: Parser.Point): source_position {
  return { line: point.row + 1, column: point.column + 1 };
}

function to_range(node: Parser.SyntaxNode): source_range {
  return {
    start: to_position(node.startPosition),
    end: to_position(node.endPosition),
    start_index: node.startIndex,
    end_index: node.endIndex,
  };
}

class tree_sitter_node implements syntax_node {
  readonly #node: Parser.SyntaxNode;
  readonly #source: string;
  readonly #parent: syntax_node | undefined;

  #range: source_range | undefined;
  #children: readonly syntax_node[] | undefined;
  #named_children: readonly syntax_node[] | undefined;

  constructor(node: Parser.SyntaxNode, source: string, parent: syntax_node | undefined) {
    this.#node = node;
    this.#source = source;
    this.#parent = parent;
  }

  get type(): string {
    return this.#node.type;
  }

  get is_named(): boolean {
    return this.#node.isNamed;
  }

  get is_missing(): boolean {
    return this.#node.isMissing;
  }

  get has_error(): boolean {
    return this.#node.hasError;
  }

  get range(): source_range {
    this.#range ??= to_range(this.#node);
    return this.#range;
  }

  /**
   * Sliced from the retained source rather than read back from the native
   * binding. `start_index`/`end_index` are UTF-16 string indices, so this is
   * exact for non-ASCII source too.
   */
  get text(): string {
    return this.#source.slice(this.#node.startIndex, this.#node.endIndex);
  }

  get children(): readonly syntax_node[] {
    this.#children ??= this.#node.children.map((child) => new tree_sitter_node(child, this.#source, this));
    return this.#children;
  }

  get named_children(): readonly syntax_node[] {
    this.#named_children ??= this.#node.namedChildren.map(
      (child) => new tree_sitter_node(child, this.#source, this),
    );
    return this.#named_children;
  }

  get parent(): syntax_node | undefined {
    return this.#parent;
  }

  child_by_field(field_name: string): syntax_node | undefined {
    const child = this.#node.childForFieldName(field_name);
    return child === null ? undefined : new tree_sitter_node(child, this.#source, this);
  }

  /**
   * Depth-first pre-order traversal using an explicit stack. Recursion would
   * risk a stack overflow on deeply nested source, which is exactly the kind of
   * input a scanner picks up from generated code.
   */
  *walk(): IterableIterator<syntax_node> {
    const stack: syntax_node[] = [this];

    while (stack.length > 0) {
      const current = stack.pop() as syntax_node;
      yield current;

      const children = current.children;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index] as syntax_node);
      }
    }
  }
}

/** Wrap a tree-sitter node. `source` must be the exact string that was parsed. */
export function wrap_syntax_node(node: Parser.SyntaxNode, source: string): syntax_node {
  return new tree_sitter_node(node, source, undefined);
}
