/**
 * `replace_symbol`: replace a symbol's whole declaration with new source.
 *
 * Given a symbol id, the tool splices the source range the index recorded for
 * that declaration out of the file and writes `new_source` in its place. The
 * range comes from the index, so the edit is exact — no fuzzy matching — and
 * the file is reindexed before the tool returns.
 *
 * The range is the declaration only (a method's body and signature, a class's
 * whole body), so callers must supply complete replacement text including any
 * indentation and trailing structure they want to keep.
 */

import type { index_project_result } from '../indexer/index_project.js';
import { tool_error } from '../mcp/errors.js';
import type { index_store } from '../store/index_store.js';
import {
  build_line_offsets,
  position_to_offset,
  read_current_file,
  write_project_file,
} from './project_file.js';

export interface replace_symbol_options {
  readonly store: index_store;
  readonly root_path: string;
  /** Bring the index up to date after the file is written. */
  readonly reindex: () => Promise<index_project_result>;
  readonly id: string;
  /** Replacement source for the whole declaration. */
  readonly new_source: string;
}

export interface replace_symbol_result {
  readonly id: string;
  readonly name: string;
  readonly file_path: string;
  readonly start_line: number;
  readonly end_line: number;
}

export async function replace_symbol(options: replace_symbol_options): Promise<replace_symbol_result> {
  const { store, root_path, reindex, id, new_source } = options;

  const symbol = store.get_symbol(id);
  if (symbol === undefined) {
    throw new tool_error(`no symbol with id '${id}'`);
  }

  const content = read_current_file(store, root_path, symbol.file_path);
  const offsets = build_line_offsets(content);
  const start = position_to_offset(offsets, symbol.start_line, symbol.start_column);
  const end = position_to_offset(offsets, symbol.end_line, symbol.end_column);
  if (end < start) {
    throw new tool_error(`symbol '${id}' has an invalid source range`);
  }

  const updated = content.slice(0, start) + new_source + content.slice(end);
  write_project_file(root_path, symbol.file_path, updated);
  await reindex();

  return {
    id: symbol.id,
    name: symbol.name,
    file_path: symbol.file_path,
    start_line: symbol.start_line,
    end_line: symbol.end_line,
  };
}
