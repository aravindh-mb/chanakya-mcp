# Security

This is a local Model Context Protocol server: it runs on a developer's machine,
reads a project tree the developer chose to open, and exposes that structure to
an AI coding agent. It does not authenticate callers, listen on a network port,
or hold secrets, so the threat model is narrow: the process is trusted, and the
input to defend against is untrusted _data_ from the agent and from the project
itself (a malicious repository someone checks out).

## What is guarded

- **Path containment.** Every path an agent can pass to an edit tool is resolved
  against the project root and must stay inside it. The check runs twice: once
  lexically (rejecting `..`, absolute paths, and drive forms) and once against
  **real paths**, so a symlink or junction inside the project that points
  outside the root cannot smuggle a read or write out of the tree. See
  `src/edit/project_file.ts`.
- **Stale-content edits.** An edit tool refuses to touch a file whose bytes no
  longer match what the index recorded, so a patch based on out-of-date
  locations cannot silently clobber unrelated changes.
- **SQL.** Every query value is bound as a parameter. Values placed inside
  `LIKE` patterns are escaped (`%`, `_`, `\`), so a query that looks like SQL or
  LIKE syntax is treated as the literal text the user asked for. See
  `src/search/search_symbols.ts` and `src/search/pattern.ts`.
- **Regular expressions.** User-supplied patterns run in a worker thread that
  the search budget can terminate, so a backtracking pattern cannot hang the
  server. A static check also refuses the nested-quantifier family up front. See
  `src/search/pattern.ts` and `src/search/regex_safety.ts`.
- **Scanner boundaries.** The index never contains a file outside the root:
  symlinks are skipped by default, and when enabled they are real-path
  containment-checked before anything is indexed.

## What is out of scope

- Malicious code the _project itself_ runs during indexing. This server parses
  source with tree-sitter; it does not execute project code, so this is limited
  to parser edge cases.
- Caller authentication. The stdio transport trusts the process that launched
  the server, which is the same process an agent already controls.

## Reporting

Security issues should be reported privately before public disclosure. Open an
issue on the repository with a description of the problem, and include a minimal
reproduction if possible. Fixes are handled through the normal review process;
security fixes take priority.
