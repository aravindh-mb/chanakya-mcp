/**
 * `apply_patch`: a safe, exact file edit.
 *
 * A patch is a sequence of text replacements. Each must match the file's
 * current content exactly once: a missing match means the file drifted from
 * what the caller expects, an ambiguous one means the caller did not say
 * precisely enough. Both are refused rather than guessed, because a fuzzy
 * patch is how silent corruption happens.
 *
 * Edits apply in order, each against the content produced by the previous one,
 * and the file is reindexed before the tool returns so the next query sees the
 * change.
 */

import type { index_project_result } from '../indexer/index_project.js';
import { tool_error } from '../mcp/errors.js';
import type { index_store } from '../store/index_store.js';
import { read_current_file, write_project_file } from './project_file.js';

export interface apply_patch_edit {
  /** Text that must occur exactly once in the current file content. */
  readonly old_text: string;
  readonly new_text: string;
}

export interface apply_patch_options {
  readonly store: index_store;
  readonly root_path: string;
  /** Bring the index up to date after the file is written. */
  readonly reindex: () => Promise<index_project_result>;
  readonly path: string;
  readonly edits: readonly apply_patch_edit[];
}

export interface apply_patch_result {
  readonly path: string;
  readonly edits_applied: number;
}

export async function apply_patch(options: apply_patch_options): Promise<apply_patch_result> {
  const { store, root_path, reindex, path } = options;

  let content = read_current_file(store, root_path, path);
  let edits_applied = 0;

  for (const edit of options.edits) {
    if (edit.old_text.length === 0) {
      throw new tool_error('a patch edit must have non-empty old_text');
    }

    const first = content.indexOf(edit.old_text);
    if (first === -1) {
      throw new tool_error(`patch edit ${edits_applied + 1} did not match: text not found in '${path}'`);
    }
    if (content.indexOf(edit.old_text, first + edit.old_text.length) !== -1) {
      throw new tool_error(
        `patch edit ${edits_applied + 1} is ambiguous: text appears more than once in '${path}'`,
      );
    }

    content = content.slice(0, first) + edit.new_text + content.slice(first + edit.old_text.length);
    edits_applied += 1;
  }

  write_project_file(root_path, path, content);
  await reindex();
  return { path, edits_applied };
}
