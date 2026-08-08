/**
 * Turns a parsed file into symbols plus `contains` relationships.
 *
 * The walk is an explicit recursive descent rather than a flat traversal,
 * because containment is the point: a method needs to know which class encloses
 * it, and a nested function needs to know which function encloses it. Export
 * and ambient state are carried down the same way, so a declaration never has
 * to look upwards to discover that it sits inside `export` or `declare`.
 *
 * Only `contains` edges are produced here. They are the one relationship kind
 * that is certain from syntax alone. Call and reference edges need name
 * resolution and come later.
 */

import type { parsed_file, syntax_node } from '../parser/types.js';
import type { language_id } from '../scanner/language.js';
import { build_symbol_id, type code_symbol, type export_kind, type symbol_kind } from '../model/symbol.js';
import { build_relationship_id, type relationship } from '../model/relationship.js';
import {
  AMBIENT_DECLARATION,
  EXPORT_STATEMENT,
  SYMBOL_KIND_BY_NODE_TYPE,
  anonymous_default_kind,
  is_function_like,
  is_function_value,
} from './node_kinds.js';
import { DEFAULT_EXPORT_NAME, is_pattern_binding, read_declaration_name } from './declaration_name.js';
import { build_signature } from './signature.js';

export interface extract_symbols_options {
  readonly parsed: parsed_file;
  /** POSIX path relative to the project root; becomes part of every symbol id. */
  readonly relative_path: string;
}

export interface extracted_symbols {
  readonly symbols: readonly code_symbol[];
  readonly relationships: readonly relationship[];
}

interface walk_context {
  readonly container_path: readonly string[];
  readonly parent_id: string | undefined;
  readonly export_kind: export_kind;
  readonly is_ambient: boolean;
  /**
   * True once the walk is inside a function body. Local data variables there
   * are not indexed — see `should_record_symbol`.
   */
  readonly in_function_body: boolean;
}

interface extraction_state {
  readonly symbols: code_symbol[];
  readonly relationships: relationship[];
  /** Guards against two declarations producing the same id in one file. */
  readonly used_ids: Set<string>;
  readonly relative_path: string;
  readonly language: language_id;
  readonly source: string;
}

export function extract_symbols(options: extract_symbols_options): extracted_symbols {
  const { parsed, relative_path } = options;

  const state: extraction_state = {
    symbols: [],
    relationships: [],
    used_ids: new Set(),
    relative_path,
    language: parsed.language,
    source: parsed.source,
  };

  const root_context: walk_context = {
    container_path: [],
    parent_id: undefined,
    export_kind: 'none',
    // Everything in a declaration file is ambient, whether or not it says `declare`.
    is_ambient: is_declaration_file(relative_path),
    in_function_body: false,
  };

  visit_children(parsed.root, root_context, state);

  return { symbols: state.symbols, relationships: state.relationships };
}

function visit_children(node: syntax_node, context: walk_context, state: extraction_state): void {
  // Crossing into a function body changes what is worth indexing, and applies
  // to callbacks too, which never become symbols themselves.
  const child_context = is_function_like(node.type) ? { ...context, in_function_body: true } : context;

  // Named children only. Every declaration is a named node, while punctuation
  // and keywords are not, so descending through them would allocate a wrapper
  // per token for nothing. The two places that genuinely need a keyword
  // (`const` and `default`) look it up directly on the node that owns it.
  for (const child of node.named_children) {
    visit(child, child_context, state);
  }
}

/**
 * Whether a declaration is worth putting in the index.
 *
 * Locals inside a function body are excluded when they hold plain data. On this
 * repository that alone was the difference between 312 and 68 indexed
 * constants: names like `stack`, `index` and `base` are meaningless to search
 * for and would bury the real results.
 *
 * Functions and classes declared inside a function body *are* kept — a named
 * callable is still something an agent looks up, however it is scoped.
 */
function should_record_symbol(kind: symbol_kind, context: walk_context): boolean {
  if (!context.in_function_body) {
    return true;
  }
  return kind !== 'variable' && kind !== 'constant';
}

function visit(
  node: syntax_node,
  context: walk_context,
  state: extraction_state,
  forced_name?: string,
): void {
  // `export ...` and `declare ...` wrap the real declaration. Adjust the
  // context and keep descending; they are not symbols themselves.
  if (node.type === EXPORT_STATEMENT) {
    visit_export_statement(node, context, state);
    return;
  }

  if (node.type === AMBIENT_DECLARATION) {
    visit_children(node, { ...context, is_ambient: true }, state);
    return;
  }

  const kind = forced_name === undefined ? resolve_symbol_kind(node) : anonymous_default_kind(node.type);
  if (kind === undefined) {
    visit_children(node, context, state);
    return;
  }

  const name = forced_name ?? resolve_name(node, context);
  if (name === undefined || !should_record_symbol(kind, context)) {
    // A destructuring pattern, an anonymous declaration, or a function-local
    // data variable. Nothing is recorded, but the contents are still walked so
    // declarations nested inside are not lost.
    visit_children(node, context, state);
    return;
  }

  const symbol = create_symbol(node, name, kind, context, state);
  state.symbols.push(symbol);

  if (context.parent_id !== undefined) {
    state.relationships.push(create_contains_edge(context.parent_id, symbol, state.relative_path));
  }

  visit_children(
    node,
    {
      container_path: [...context.container_path, name],
      parent_id: symbol.id,
      // Nested declarations are not exported just because their container is.
      export_kind: 'none',
      is_ambient: context.is_ambient,
      in_function_body: context.in_function_body,
    },
    state,
  );
}

/**
 * Handle `export ...`, including the anonymous default forms.
 *
 * `export default function () {}` binds no name, but consumers address it as
 * the module's default, so it is recorded under the name `default`. Only the
 * statement's direct value is treated this way — nested function expressions
 * such as callbacks are left alone.
 */
function visit_export_statement(node: syntax_node, context: walk_context, state: extraction_state): void {
  const export_kind = read_export_kind(node);
  const inner_context: walk_context = { ...context, export_kind };

  if (export_kind === 'default') {
    const value = node.child_by_field('value');
    if (value !== undefined && anonymous_default_kind(value.type) !== undefined) {
      visit(value, inner_context, state, DEFAULT_EXPORT_NAME);
      return;
    }
  }

  visit_children(node, inner_context, state);
}

/**
 * The kind for a declaration node, or `undefined` when it is not a declaration.
 *
 * `variable_declarator` needs the surrounding keyword and the initializer, so
 * it is resolved here rather than in the static table.
 */
function resolve_symbol_kind(node: syntax_node): symbol_kind | undefined {
  const mapped = SYMBOL_KIND_BY_NODE_TYPE[node.type];
  if (mapped !== undefined) {
    return mapped;
  }

  if (node.type !== 'variable_declarator') {
    return undefined;
  }

  // `const f = () => {}` is a function in every way that matters to someone
  // searching for one, so it is recorded as a function rather than a constant.
  // This is the dominant declaration style in React and modern TypeScript.
  const value = node.child_by_field('value');
  if (value !== undefined && is_function_value(value.type)) {
    return 'function';
  }

  return is_const_declaration(node) ? 'constant' : 'variable';
}

/** `const` gives `constant`; `let` and `var` give `variable`. */
function is_const_declaration(declarator: syntax_node): boolean {
  const declaration = declarator.parent;
  if (declaration === undefined) {
    return false;
  }
  return declaration.children.some((child) => !child.is_named && child.text === 'const');
}

function resolve_name(node: syntax_node, context: walk_context): string | undefined {
  if (node.type === 'variable_declarator' && is_pattern_binding(node)) {
    // Destructuring binds several names at once. They are left out rather than
    // reported under an invented single name; they are still visible as
    // references once reference extraction lands.
    return undefined;
  }

  const name = read_declaration_name(node);
  if (name !== undefined) {
    return name;
  }

  // `export default function () {}` has no name but is addressable as `default`.
  return context.export_kind === 'default' ? DEFAULT_EXPORT_NAME : undefined;
}

function create_symbol(
  node: syntax_node,
  name: string,
  kind: symbol_kind,
  context: walk_context,
  state: extraction_state,
): code_symbol {
  const container_path = [...context.container_path, name];
  const id = allocate_id(state, container_path, kind);

  // A declarator's `const`/`let` keyword lives on the parent declaration, so
  // the signature starts there to read as `const handler = (a: number)`.
  const signature_start =
    node.type === 'variable_declarator' && node.parent !== undefined
      ? node.parent.range.start_index
      : node.range.start_index;

  const signature = build_signature(node, state.source, signature_start);

  return {
    id,
    name,
    kind,
    file_path: state.relative_path,
    language: state.language,
    start_line: node.range.start.line,
    end_line: node.range.end.line,
    start_column: node.range.start.column,
    end_column: node.range.end.column,
    parent_id: context.parent_id,
    signature,
    export_kind: context.export_kind,
    is_ambient: context.is_ambient,
  };
}

/**
 * Produce an unused id, appending a disambiguator only when necessary.
 *
 * Overloads and merged declarations legitimately repeat a name in one scope.
 * The first one keeps the clean id so the common case stays readable.
 */
function allocate_id(state: extraction_state, container_path: readonly string[], kind: symbol_kind): string {
  const base = build_symbol_id({ file_path: state.relative_path, kind, container_path });
  if (!state.used_ids.has(base)) {
    state.used_ids.add(base);
    return base;
  }

  let disambiguator = 2;
  for (;;) {
    const candidate = build_symbol_id({
      file_path: state.relative_path,
      kind,
      container_path,
      disambiguator,
    });
    if (!state.used_ids.has(candidate)) {
      state.used_ids.add(candidate);
      return candidate;
    }
    disambiguator += 1;
  }
}

function create_contains_edge(parent_id: string, symbol: code_symbol, relative_path: string): relationship {
  return {
    id: build_relationship_id({
      kind: 'contains',
      from_id: parent_id,
      to_name: symbol.name,
      file_path: relative_path,
      line: symbol.start_line,
    }),
    kind: 'contains',
    from_id: parent_id,
    to_id: symbol.id,
    to_name: symbol.name,
    // Containment is read straight off the tree, so it cannot be wrong.
    confidence: 'certain',
    file_path: relative_path,
    line: symbol.start_line,
  };
}

function read_export_kind(export_statement: syntax_node): export_kind {
  const has_default = export_statement.children.some((child) => !child.is_named && child.text === 'default');
  return has_default ? 'default' : 'named';
}

function is_declaration_file(relative_path: string): boolean {
  return /\.d\.(ts|mts|cts)$/i.test(relative_path);
}
