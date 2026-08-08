# Edits

Three edit tools write files and reindex automatically, and each is safe by construction:

- **`apply_patch`** applies exact text replacements in order. An `old_text` that does not match, or
  matches more than once, refuses the whole call rather than guessing.
- **`replace_symbol`** splices new source over a symbol's declaration at the exact source range the index
  recorded — no fuzzy matching.
- **`rename_symbol`** renames a symbol at its declaration, every resolved reference, and the import and
  export bindings that connect it to other files (including re-exports through barrels). Occurrences the
  index could not resolve are left alone.

## Why edits are safe

Edits never escape the project root, and a file whose content drifted from the index since the last run
refuses any edit to it — every edit requires a fresh index. Because the index refreshes on each edit, a
second edit is checked against the state the first one produced.

### Path containment

Every path an agent can pass to an edit tool is resolved against the project root and must stay inside
it. The check runs twice: once lexically (rejecting `..`, absolute paths, and drive forms) and once
against **real paths**, so a symlink or junction inside the project that points outside the root cannot
smuggle a read or write out of the tree.

### Stale-content rejection

An edit tool refuses to touch a file whose bytes no longer match what the index recorded, so a patch
based on out-of-date locations cannot silently clobber unrelated changes. This is what makes a second
edit safe: the index refreshes after the first, so the second edit is validated against the state the
first produced.

### Exactness over guessing

`apply_patch` requires each `old_text` to match exactly once. A missing match means the file drifted
from what the caller expected; an ambiguous one means the caller did not say precisely enough. Both are
refused rather than guessed, because a fuzzy patch is how silent corruption happens.
