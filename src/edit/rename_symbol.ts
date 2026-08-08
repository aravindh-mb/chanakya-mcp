/**
 * `rename_symbol`: rename a symbol at its declaration, every indexed
 * occurrence, and the import/export bindings that connect it to other files.
 *
 * References give exact offsets for uses; the declaration itself is one of
 * them. Import and export bindings are not references (a binding is not a use),
 * but a rename that skipped them would leave broken code behind — so they are
 * located too: an import is renamed only when following its module's export
 * chain leads to this symbol, which also keeps an unrelated same-named symbol
 * in another module untouched. Every occurrence is verified against the current
 * source before anything is written, and all files are staleness-checked up
 * front, so a rename is all-or-nothing.
 */

import { resolve_module_specifier } from '../extract/module_resolution.js';
import type { index_project_result } from '../indexer/index_project.js';
import { tool_error } from '../mcp/errors.js';
import { find_references } from '../navigation/navigation.js';
import type { index_store } from '../store/index_store.js';
import {
  build_line_offsets,
  position_to_offset,
  read_current_file,
  write_project_file,
} from './project_file.js';

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export interface rename_symbol_options {
  readonly store: index_store;
  readonly root_path: string;
  /** Bring the index up to date after every file is written. */
  readonly reindex: () => Promise<index_project_result>;
  readonly id: string;
  readonly new_name: string;
}

export interface rename_file_result {
  readonly file_path: string;
  readonly changes: number;
}

export interface rename_symbol_result {
  readonly id: string;
  readonly old_name: string;
  readonly new_name: string;
  readonly files: readonly rename_file_result[];
  /** Uses and the declaration, renamed at exact offsets. */
  readonly references_renamed: number;
  /** Import and export bindings renamed, located by line. */
  readonly bindings_renamed: number;
  readonly total_changes: number;
}

/** A planned replacement inside one file, in descending offset order. */
interface replacement {
  readonly start: number;
  readonly end: number;
}

export async function rename_symbol(options: rename_symbol_options): Promise<rename_symbol_result> {
  const { store, root_path, reindex, id, new_name } = options;

  if (!IDENTIFIER_PATTERN.test(new_name)) {
    throw new tool_error(`'${new_name}' is not a valid identifier`);
  }

  const symbol = store.get_symbol(id);
  if (symbol === undefined) {
    throw new tool_error(`no symbol with id '${id}'`);
  }
  const old_name = symbol.name;
  if (old_name === new_name) {
    throw new tool_error(`symbol '${id}' is already named '${new_name}'`);
  }

  const references = find_references({ store }, id).references;
  const definition = references.find((reference) => reference.is_definition);
  const files: ReadonlySet<string> = new Set(store.list_file_paths());

  // Locate the import and export bindings that carry this symbol's name.
  const line_targets = new Map<string, Map<number, number>>();
  for (const imported of store.get_all_imports()) {
    if (!mentions(imported.imported_name, imported.local_name, old_name)) {
      continue;
    }
    if (
      binds_symbol(
        store,
        id,
        imported.resolved_path,
        imported.imported_name ?? imported.local_name ?? old_name,
        files,
        new Set(),
      )
    ) {
      add_line_target(line_targets, imported.file_path, imported.line);
    }
  }
  for (const exported of store.get_all_exports()) {
    if (!mentions(exported.exported_name, exported.local_name, old_name)) {
      continue;
    }
    if (exported.symbol_id === id) {
      // An inline `export class x` is the declaration itself (already renamed by
      // its definition reference); only a separate `export { x }` specifier is
      // an additional binding to rename.
      if (definition !== undefined && definition.line === exported.line) {
        continue;
      }
      add_line_target(line_targets, exported.file_path, exported.line);
    } else if (exported.kind === 're_export' && exported.module_specifier !== undefined) {
      const target = resolve_module_specifier({
        from_file_path: exported.file_path,
        module_specifier: exported.module_specifier,
        files,
      });
      if (binds_symbol(store, id, target, exported.local_name ?? exported.exported_name, files, new Set())) {
        add_line_target(line_targets, exported.file_path, exported.line);
      }
    }
  }

  if (references.length === 0 && line_targets.size === 0) {
    throw new tool_error(`no indexed occurrences of '${id}'`);
  }

  // Read and staleness-check every file before touching any of them, so the
  // rename cannot half-apply.
  const by_file = new Map<
    string,
    {
      content: string;
      offsets: readonly number[];
      offsets_to_replace: number[];
      lines_to_replace: Map<number, number>;
    }
  >();
  for (const reference of references) {
    let entry = by_file.get(reference.file_path);
    if (entry === undefined) {
      const content = read_current_file(store, root_path, reference.file_path);
      entry = {
        content,
        offsets: build_line_offsets(content),
        offsets_to_replace: [],
        lines_to_replace: new Map(),
      };
      by_file.set(reference.file_path, entry);
    }
    entry.offsets_to_replace.push(position_to_offset(entry.offsets, reference.line, reference.column));
  }
  for (const [file_path, lines] of line_targets) {
    let entry = by_file.get(file_path);
    if (entry === undefined) {
      const content = read_current_file(store, root_path, file_path);
      entry = {
        content,
        offsets: build_line_offsets(content),
        offsets_to_replace: [],
        lines_to_replace: new Map(),
      };
      by_file.set(file_path, entry);
    }
    for (const [line, count] of lines) {
      entry.lines_to_replace.set(line, (entry.lines_to_replace.get(line) ?? 0) + count);
    }
  }

  // Verify and collect every replacement. A mismatch anywhere — a use whose
  // text is no longer the symbol's name, a binding line with the wrong number
  // of matches — refuses the whole rename rather than guessing.
  const file_results: rename_file_result[] = [];
  let references_renamed = 0;
  let bindings_renamed = 0;

  for (const [file_path, entry] of by_file) {
    const replacements: replacement[] = [];

    for (const offset of entry.offsets_to_replace) {
      const actual = entry.content.slice(offset, offset + old_name.length);
      if (actual !== old_name) {
        throw new tool_error(
          `occurrence at ${file_path} reads '${actual}', expected '${old_name}'; refusing to guess`,
        );
      }
      replacements.push({ start: offset, end: offset + old_name.length });
    }

    for (const [line, expected] of entry.lines_to_replace) {
      const line_start = position_to_offset(entry.offsets, line, 1);
      const line_end = line < entry.offsets.length ? entry.offsets[line]! : entry.content.length;
      const matches = collect_identifier_ranges(entry.content, line_start, line_end, old_name);
      if (matches.length !== expected) {
        throw new tool_error(
          `expected ${expected} occurrence(s) of '${old_name}' on ${file_path}:${line}, ` +
            `found ${matches.length}; refusing to guess`,
        );
      }
      for (const match of matches) {
        replacements.push(match);
      }
    }

    replacements.sort((left, right) => right.start - left.start);
    let updated = entry.content;
    for (const replacement of replacements) {
      updated = updated.slice(0, replacement.start) + new_name + updated.slice(replacement.end);
    }

    write_project_file(root_path, file_path, updated);
    references_renamed += entry.offsets_to_replace.length;
    let file_bindings = 0;
    for (const count of entry.lines_to_replace.values()) {
      file_bindings += count;
    }
    bindings_renamed += file_bindings;
    file_results.push({ file_path, changes: replacements.length });
  }

  await reindex();

  return {
    id,
    old_name,
    new_name,
    files: file_results,
    references_renamed,
    bindings_renamed,
    total_changes: references_renamed + bindings_renamed,
  };
}

function mentions(exported: string | undefined, local: string | undefined, old_name: string): boolean {
  return exported === old_name || local === old_name;
}

function add_line_target(
  line_targets: Map<string, Map<number, number>>,
  file_path: string,
  line: number,
): void {
  const by_line = line_targets.get(file_path) ?? new Map<number, number>();
  by_line.set(line, (by_line.get(line) ?? 0) + 1);
  line_targets.set(file_path, by_line);
}

/**
 * Whole-identifier occurrences of `name` on the slice `[start, end)`, as
 * replacement ranges. `name` comes from the index so it is identifier-shaped
 * and safe to interpolate into the word-boundary pattern.
 */
function collect_identifier_ranges(content: string, start: number, end: number, name: string): replacement[] {
  const pattern = new RegExp(`\\b${name}\\b`, 'g');
  pattern.lastIndex = start;
  const ranges: replacement[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match.index >= end) {
      break;
    }
    ranges.push({ start: match.index, end: match.index + name.length });
  }
  return ranges;
}

/**
 * True when a module, and everything it re-exports, exposes `name` as the
 * symbol with id `symbol_id`. This is what ties an import or re-export
 * binding to the symbol being renamed — and only to that symbol.
 */
function binds_symbol(
  store: index_store,
  symbol_id: string,
  target_file: string | undefined,
  name: string,
  files: ReadonlySet<string>,
  visited: Set<string>,
): boolean {
  if (target_file === undefined || visited.has(target_file)) {
    return false;
  }
  visited.add(target_file);

  let matched = false;
  for (const exported of store.get_exports_in_file(target_file)) {
    if (exported.exported_name === '*') {
      // `export * from 'm'` re-exports every name; follow it with the same one.
      if (exported.module_specifier !== undefined) {
        const target = resolve_module_specifier({
          from_file_path: exported.file_path,
          module_specifier: exported.module_specifier,
          files,
        });
        if (target !== undefined && binds_symbol(store, symbol_id, target, name, files, visited)) {
          matched = true;
        }
      }
      continue;
    }
    if (exported.exported_name !== name) {
      continue;
    }
    if (exported.symbol_id === symbol_id) {
      matched = true;
    } else if (exported.kind === 're_export' && exported.module_specifier !== undefined) {
      const target = resolve_module_specifier({
        from_file_path: exported.file_path,
        module_specifier: exported.module_specifier,
        files,
      });
      if (target !== undefined && binds_symbol(store, symbol_id, target, name, files, visited)) {
        matched = true;
      }
    }
  }
  return matched;
}
