/**
 * Extracting name references from a parsed file.
 *
 * A reference is every mention of an identifier — a use in an expression, a
 * type name in an annotation, a member access, or a declaration's own name
 * (`is_definition`). Each is recorded with the innermost symbol that encloses
 * it and, when the name resolves unambiguously, the symbol it points at.
 *
 * Binding contexts produce no reference: parameters, destructuring patterns,
 * import/export specifiers, object keys and class/interface member names are
 * not uses of a name, and members the model has no symbol kind for are not
 * references either.
 */

import type { parsed_file, syntax_node } from '../parser/types.js';
import type { code_reference } from '../model/module_graph.js';
import type { code_symbol } from '../model/symbol.js';
import {
  build_scope_index,
  build_start_index,
  read_chain,
  resolve_member_chain,
  resolve_name,
  scope_tracker,
  symbol_at,
  type scope_index,
} from './scope_resolver.js';

export interface extract_references_options {
  readonly parsed: parsed_file;
  /** POSIX path relative to the project root. */
  readonly relative_path: string;
  /** The file's own symbols, for scope-aware resolution. */
  readonly symbols: readonly code_symbol[];
}

/** Node types that carry a name mention. */
const REFERENCE_NODE_TYPES: ReadonlySet<string> = new Set([
  'identifier',
  'type_identifier',
  'property_identifier',
  'shorthand_property_identifier',
]);

/**
 * Parent node types whose `name` field is a declaration the model records.
 * Only these produce definition references.
 */
const DEFINITION_PARENTS: ReadonlySet<string> = new Set([
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'internal_module',
  'module',
  'method_definition',
  'method_signature',
  'abstract_method_signature',
  'function_signature',
  'variable_declarator',
]);

/**
 * Contexts where a name is a binding or a key, never a use. These are skipped
 * before the definition check so a parameter does not become a "definition"
 * of a symbol that does not exist.
 */
const BINDING_PARENTS: ReadonlySet<string> = new Set([
  'required_parameter',
  'optional_parameter',
  'object_pattern',
  'array_pattern',
  'pair_pattern',
  'shorthand_property_identifier_pattern',
  'import_specifier',
  'export_specifier',
  'namespace_import',
  'import_clause',
  'catch_clause',
  'for_in_statement',
  'index_signature',
  'type_parameter',
  // A named function/class expression binds its own name; it is not indexed.
  'function_expression',
  'class',
  'class_expression',
  // Members the model has no symbol kind for.
  'public_field_definition',
  'field_definition',
  'property_signature',
  'enum_body',
  // JSX attribute names and closing tags are not uses of project names.
  'jsx_attribute',
  'jsx_closing_element',
]);

export function extract_references(options: extract_references_options): readonly code_reference[] {
  const { parsed, relative_path, symbols } = options;
  const scope = build_scope_index(symbols);
  const symbols_by_start = build_start_index(symbols);
  const tracker = new scope_tracker(symbols_by_start);

  const references: code_reference[] = [];
  const used_ids = new Set<string>();

  for (const node of parsed.root.walk()) {
    // The tracker must see every node: symbol starts align with declaration
    // nodes, and a name or call inside a body needs those declarations already
    // pushed to know what encloses it.
    const { enclosing_id } = tracker.advance(node);

    if (!REFERENCE_NODE_TYPES.has(node.type)) {
      continue;
    }

    const reference = classify(node, relative_path, scope, symbols_by_start, enclosing_id);
    if (reference === undefined) {
      continue;
    }

    const base_id = `${relative_path}#ref:${reference.name}@${reference.line}:${reference.column}`;
    let id = base_id;
    let disambiguator = 2;
    while (used_ids.has(id)) {
      id = `${base_id}~${disambiguator}`;
      disambiguator += 1;
    }
    used_ids.add(id);

    references.push({ ...reference, id });
  }

  return references;
}

function classify(
  node: syntax_node,
  relative_path: string,
  scope: scope_index,
  symbols_by_start: ReadonlyMap<string, code_symbol>,
  enclosing_id: string | undefined,
): code_reference | undefined {
  const parent = node.parent;
  if (parent === undefined) {
    return undefined;
  }

  const is_definition = field_node_matches(parent, 'name', node);

  if (is_definition) {
    if (!DEFINITION_PARENTS.has(parent.type)) {
      return undefined;
    }
    return {
      id: '',
      file_path: relative_path,
      name: node.text,
      // A declaration's name binds the symbol whose declaration is its parent
      // node; the two share a start position, so no name resolution is needed.
      symbol_id: symbol_at(symbols_by_start, parent.range.start.line, parent.range.start.column)?.id,
      enclosing_symbol_id: enclosing_id,
      line: node.range.start.line,
      column: node.range.start.column,
      is_definition: true,
    };
  }

  if (BINDING_PARENTS.has(parent.type)) {
    return undefined;
  }

  if (node.type === 'property_identifier' && parent.type === 'pair') {
    // An object literal key names a property, not a variable.
    return undefined;
  }

  if (parent.type === 'call_expression' && field_node_matches(parent, 'function', node) && node.text === 'require') {
    // The CommonJS global, handled by the import extractor instead.
    return undefined;
  }

  if (parent.type === 'member_expression' && field_node_matches(parent, 'property', node)) {
    const chain = read_chain(parent);
    return {
      id: '',
      file_path: relative_path,
      name: node.text,
      symbol_id: chain === undefined ? undefined : resolve_member_chain(scope, chain, enclosing_id)?.id,
      enclosing_symbol_id: enclosing_id,
      line: node.range.start.line,
      column: node.range.start.column,
      is_definition: false,
    };
  }

  return {
    id: '',
    file_path: relative_path,
    name: node.text,
    symbol_id: resolve_name(scope, node.text, enclosing_id)?.id,
    enclosing_symbol_id: enclosing_id,
    line: node.range.start.line,
    column: node.range.start.column,
    is_definition: false,
  };
}

/** Whether `child` is the node in `parent`'s named field `field`. */
function field_node_matches(parent: syntax_node, field: string, child: syntax_node): boolean {
  const field_node = parent.child_by_field(field);
  return (
    field_node !== undefined &&
    field_node.range.start_index === child.range.start_index &&
    field_node.range.end_index === child.range.end_index
  );
}
