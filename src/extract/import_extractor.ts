/**
 * Extracting imports from a parsed file.
 *
 * Covers the four static import forms (`import { a } from`, `import a from`,
 * `import * as ns from`, `import 'm'`), plus the two dynamic ones an agent is
 * likely to ask about: `require('m')` in CommonJS and `await import('m')`.
 *
 * Resolution is best-effort per file: the specifier is resolved against the
 * set of files the current scan knows about. A specifier that points outside
 * the project, or at a file the index excludes, is recorded honestly with no
 * `resolved_path` rather than guessed at.
 */

import type { parsed_file, syntax_node } from '../parser/types.js';
import { is_internal_specifier, type code_import, type import_kind } from '../model/module_graph.js';
import { unquote } from './string_literal.js';
import {
  resolve_module_specifier,
  type file_index,
} from './module_resolution.js';

/** The `import` keyword inside `import('m')` — not a callable identifier. */
const DYNAMIC_IMPORT = 'import';

export interface extract_imports_options {
  readonly parsed: parsed_file;
  /** POSIX path relative to the project root. */
  readonly relative_path: string;
  /**
   * Files the current scan knows about, for specifier resolution. Without one
   * the import is recorded with no resolved path.
   */
  readonly files?: file_index;
}

export function extract_imports(options: extract_imports_options): readonly code_import[] {
  const { parsed, relative_path } = options;
  const files = options.files ?? new Set<string>();

  const imports: code_import[] = [];
  const used_ids = new Set<string>();

  for (const node of parsed.root.walk()) {
    if (node.type === 'import_statement') {
      read_static_import(node, relative_path, files, imports, used_ids);
    } else if (node.type === 'call_expression') {
      read_dynamic_import(node, relative_path, files, imports, used_ids);
    }
  }

  return imports;
}

function read_static_import(
  node: syntax_node,
  relative_path: string,
  files: file_index,
  imports: code_import[],
  used_ids: Set<string>,
): void {
  const source = node.child_by_field('source');
  if (source === undefined) {
    return;
  }
  const specifier = unquote(source.text);
  if (specifier.length === 0) {
    return;
  }

  const resolved_path = resolve_module_specifier({
    from_file_path: relative_path,
    module_specifier: specifier,
    files,
  });
  const common = {
    file_path: relative_path,
    module_specifier: specifier,
    resolved_path,
    is_internal: is_internal_specifier(specifier),
    line: node.range.start.line,
  };

  const import_clause =
    node.child_by_field('import_clause') ?? node.named_children.find((child) => child.type === 'import_clause');

  if (import_clause === undefined) {
    // `import 'm';` — a side effect, no binding at all.
    imports.push(
      build_import(
        common,
        'side_effect',
        undefined,
        undefined,
        node,
        used_ids,
      ),
    );
    return;
  }

  for (const child of import_clause.named_children) {
    switch (child.type) {
      case 'named_imports': {
        for (const specifier_node of child.named_children) {
          if (specifier_node.type !== 'import_specifier') {
            continue;
          }
          const imported = specifier_node.child_by_field('name');
          const alias = specifier_node.child_by_field('alias');
          if (imported === undefined) {
            continue;
          }
          imports.push(
            build_import(
              common,
              'named',
              imported.text,
              alias?.text ?? imported.text,
              specifier_node,
              used_ids,
            ),
          );
        }
        break;
      }
      case 'namespace_import': {
        const name = child.child_by_field('name') ?? child.named_children[0];
        if (name !== undefined) {
          imports.push(build_import(common, 'namespace', undefined, name.text, name, used_ids));
        }
        break;
      }
      case 'identifier': {
        // The default binding: `import a from 'm'`.
        imports.push(build_import(common, 'default', 'default', child.text, child, used_ids));
        break;
      }
      default:
        break;
    }
  }
}

function read_dynamic_import(
  node: syntax_node,
  relative_path: string,
  files: file_index,
  imports: code_import[],
  used_ids: Set<string>,
): void {
  const callee = node.child_by_field('function');
  if (callee === undefined) {
    return;
  }

  if (callee.type === DYNAMIC_IMPORT) {
    const specifier = read_single_string_argument(node);
    if (specifier !== undefined) {
      imports.push(
        build_import(
          {
            file_path: relative_path,
            module_specifier: specifier,
            resolved_path: resolve_module_specifier({
              from_file_path: relative_path,
              module_specifier: specifier,
              files,
            }),
            is_internal: is_internal_specifier(specifier),
            line: node.range.start.line,
          },
          'dynamic',
          undefined,
          undefined,
          node,
          used_ids,
        ),
      );
    }
    return;
  }

  // `const x = require('m')` — the local name is the declarator's binding.
  if (callee.type === 'identifier' && callee.text === 'require') {
    const specifier = read_single_string_argument(node);
    if (specifier !== undefined) {
      imports.push(
        build_import(
          {
            file_path: relative_path,
            module_specifier: specifier,
            resolved_path: resolve_module_specifier({
              from_file_path: relative_path,
              module_specifier: specifier,
              files,
            }),
            is_internal: is_internal_specifier(specifier),
            line: node.range.start.line,
          },
          'require',
          undefined,
          read_require_binding(node),
          node,
          used_ids,
        ),
      );
    }
  }
}

function read_single_string_argument(call: syntax_node): string | undefined {
  const arguments_node = call.child_by_field('arguments');
  if (arguments_node === undefined) {
    return undefined;
  }
  const first = arguments_node.named_children[0];
  if (first === undefined || first.type !== 'string') {
    return undefined;
  }
  const value = unquote(first.text);
  return value.length === 0 ? undefined : value;
}

/** The name bound by `const x = require('m')`, when the require is the value. */
function read_require_binding(call: syntax_node): string | undefined {
  const declarator = call.parent;
  if (declarator?.type !== 'variable_declarator') {
    return undefined;
  }
  const value = declarator.child_by_field('value');
  if (
    value === undefined ||
    value.range.start_index !== call.range.start_index ||
    value.range.end_index !== call.range.end_index
  ) {
    return undefined;
  }
  const name = declarator.child_by_field('name');
  return name?.type === 'identifier' ? name.text : undefined;
}

interface import_base {
  readonly file_path: string;
  readonly module_specifier: string;
  readonly resolved_path: string | undefined;
  readonly is_internal: boolean;
  readonly line: number;
}

function build_import(
  base: import_base,
  kind: import_kind,
  imported_name: string | undefined,
  local_name: string | undefined,
  anchor: syntax_node,
  used_ids: Set<string>,
): code_import {
  const base_id = `${base.file_path}#import:${imported_name ?? local_name ?? base.module_specifier}@${
    anchor.range.start.line
  }:${anchor.range.start.column}`;

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
    kind,
    module_specifier: base.module_specifier,
    imported_name,
    local_name,
    resolved_path: base.resolved_path,
    is_internal: base.is_internal,
    line: base.line,
  };
}
