/**
 * Extracting exports from a parsed file.
 *
 * Covers declared exports (`export class A {}`), export lists
 * (`export { a, b as c }`), re-exports (`export { a } from 'm'`,
 * `export * from 'm'`) and the anonymous default forms.
 *
 * The export row points at the symbol it exports when that symbol is declared
 * in this file. Re-exports and `export default <expression>` cannot point at a
 * local symbol and honestly carry none.
 */

import type { parsed_file, syntax_node } from '../parser/types.js';
import { anonymous_default_kind } from './node_kinds.js';
import { DEFAULT_EXPORT_NAME, read_declaration_name } from './declaration_name.js';
import type { code_export, export_kind_detail } from '../model/module_graph.js';
import type { code_symbol } from '../model/symbol.js';
import { build_scope_index, resolve_declaration, type scope_index } from './scope_resolver.js';
import { unquote } from './string_literal.js';

/**
 * Node types the `declaration` part of an export statement wraps, across the
 * JavaScript and TypeScript grammars. The grammars differ in whether these
 * appear as named fields, so the extractor also recognises them by type.
 */
const DECLARED_EXPORT_TYPES: ReadonlySet<string> = new Set([
  'lexical_declaration',
  'variable_declaration',
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'internal_module',
  'module',
  'function_signature',
]);

export interface extract_exports_options {
  readonly parsed: parsed_file;
  /** POSIX path relative to the project root. */
  readonly relative_path: string;
  /** The file's own symbols, so exports can point at their declarations. */
  readonly symbols: readonly code_symbol[];
}

export function extract_exports(options: extract_exports_options): readonly code_export[] {
  const { parsed, relative_path, symbols } = options;
  const scope = build_scope_index(symbols);

  const exports: code_export[] = [];
  const used_ids = new Set<string>();

  for (const node of parsed.root.walk()) {
    if (node.type !== 'export_statement') {
      continue;
    }
    read_export_statement(node, relative_path, scope, exports, used_ids);
  }

  return exports;
}

function read_export_statement(
  node: syntax_node,
  relative_path: string,
  scope: scope_index,
  exports: code_export[],
  used_ids: Set<string>,
): void {
  const source =
    node.child_by_field('source') ?? node.named_children.find((child) => child.type === 'string');
  const is_default = node.children.some((child) => !child.is_named && child.text === 'default');

  // `export { a, b as c }` — with or without a `from` source.
  const export_clause =
    node.child_by_field('export_clause') ?? node.named_children.find((child) => child.type === 'export_clause');
  if (export_clause !== undefined) {
    for (const specifier of export_clause.named_children) {
      if (specifier.type !== 'export_specifier') {
        continue;
      }
      read_export_specifier(specifier, relative_path, scope, exports, used_ids, source);
    }
    return;
  }

  // `export * from 'm'` — the whole module, no single name.
  if (source !== undefined && !is_default) {
    exports.push(
      build_export(
        {
          file_path: relative_path,
          kind: 're_export',
          exported_name: '*',
          local_name: undefined,
          symbol_id: undefined,
          module_specifier: unquote(source.text),
        },
        source,
        used_ids,
      ),
    );
    return;
  }

  // `export const a = 1` / `export class A {}` / `export default ...`.
  const declaration =
    node.child_by_field('declaration') ??
    node.named_children.find((child) => DECLARED_EXPORT_TYPES.has(child.type));
  if (declaration !== undefined) {
    read_declared_export(declaration, relative_path, scope, exports, used_ids, is_default);
    return;
  }

  // `export default <expression>` — a value, not a symbol. Recorded because
  // consumers can import it. An anonymous function or class still has a symbol
  // to point at: the one recorded under the name `default`.
  if (is_default) {
    const value =
      node.child_by_field('value') ??
      node.named_children.find(
        (child) =>
          !DECLARED_EXPORT_TYPES.has(child.type) && child.type !== 'export_clause' && child.type !== 'string',
      );
    if (value !== undefined) {
      const anonymous = anonymous_default_kind(value.type);
      const symbol_id =
        anonymous === undefined ? undefined : resolve_declaration(scope, DEFAULT_EXPORT_NAME, undefined)?.id;
      exports.push(
        build_export(
          {
            file_path: relative_path,
            kind: 'default',
            exported_name: DEFAULT_EXPORT_NAME,
            local_name: undefined,
            symbol_id,
            module_specifier: undefined,
          },
          value,
          used_ids,
        ),
      );
    }
  }
}

function read_export_specifier(
  specifier: syntax_node,
  relative_path: string,
  scope: scope_index,
  exports: code_export[],
  used_ids: Set<string>,
  source: syntax_node | undefined,
): void {
  const name = specifier.child_by_field('name');
  const alias = specifier.child_by_field('alias');
  if (name === undefined) {
    return;
  }

  const local_name = name.text;
  const exported_name = alias?.text ?? local_name;

  if (source !== undefined) {
    exports.push(
      build_export(
        {
          file_path: relative_path,
          kind: 're_export',
          exported_name,
          local_name,
          symbol_id: undefined,
          module_specifier: unquote(source.text),
        },
        specifier,
        used_ids,
      ),
    );
    return;
  }

  exports.push(
    build_export(
      {
        file_path: relative_path,
        kind: 'named',
        exported_name,
        local_name,
        symbol_id: resolve_declaration(scope, local_name, undefined)?.id,
        module_specifier: undefined,
      },
      specifier,
      used_ids,
    ),
  );
}

function read_declared_export(
  declaration: syntax_node,
  relative_path: string,
  scope: scope_index,
  exports: code_export[],
  used_ids: Set<string>,
  is_default: boolean,
): void {
  const kind: export_kind_detail = is_default ? 'default' : 'named';

  // `export const a = 1, b = 2` declares several names under one statement.
  const names = declared_names(declaration);
  if (names.length === 0) {
    return;
  }

  for (const name of names) {
    const symbol = resolve_declaration(scope, name, undefined);
    exports.push(
      build_export(
        {
          file_path: relative_path,
          kind,
          exported_name: is_default ? DEFAULT_EXPORT_NAME : name,
          local_name: name,
          symbol_id: symbol?.id,
          module_specifier: undefined,
        },
        declaration,
        used_ids,
      ),
    );
  }
}

/**
 * The names bound by an exported declaration statement.
 *
 * A single declaration wraps one or more variable declarators, each of which
 * may bind several names under a destructuring pattern — and those are
 * deliberately left out, matching the symbol extractor: no name is invented
 * for a pattern.
 */
function declared_names(declaration: syntax_node): readonly string[] {
  if (declaration.type === 'variable_declaration' || declaration.type === 'lexical_declaration') {
    return declaration.named_children
      .filter((child) => child.type === 'variable_declarator')
      .flatMap((declarator) => {
        const name = read_declaration_name(declarator);
        return name === undefined ? [] : [name];
      });
  }

  const name = read_declaration_name(declaration);
  return name === undefined ? [] : [name];
}

interface export_base {
  readonly file_path: string;
  readonly kind: export_kind_detail;
  readonly exported_name: string;
  readonly local_name: string | undefined;
  readonly symbol_id: string | undefined;
  readonly module_specifier: string | undefined;
}

function build_export(
  base: export_base,
  anchor: syntax_node,
  used_ids: Set<string>,
): code_export {
  const base_id = `${base.file_path}#export:${base.exported_name}@${anchor.range.start.line}:${anchor.range.start.column}`;

  let id = base_id;
  let disambiguator = 2;
  while (used_ids.has(id)) {
    id = `${base_id}~${disambiguator}`;
    disambiguator += 1;
  }
  used_ids.add(id);

  return {
    id,
    file_path: base.file_path,
    kind: base.kind,
    exported_name: base.exported_name,
    local_name: base.local_name,
    symbol_id: base.symbol_id,
    module_specifier: base.module_specifier,
    line: anchor.range.start.line,
  };
}
