# Scanning & Languages

## Supported languages

| Language   | Extensions                  | Detected | Parsed | Grammar                      |
| ---------- | --------------------------- | -------- | ------ | ---------------------------- |
| JavaScript | `.js` `.mjs` `.cjs`         | Yes      | Yes    | tree-sitter-javascript       |
| JSX        | `.jsx`                      | Yes      | Yes    | tree-sitter-javascript       |
| TypeScript | `.ts` `.mts` `.cts` `.d.ts` | Yes      | Yes    | tree-sitter-typescript       |
| TSX        | `.tsx`                      | Yes      | Yes    | tree-sitter-typescript (tsx) |

`jsx` maps to the JavaScript grammar because tree-sitter's JavaScript grammar parses JSX natively.
TypeScript is the opposite case: `.ts` and `.tsx` genuinely need different grammars, which is why they
are separate language ids.

Language is decided by file extension only. Sniffing a `.js` file to guess whether it "really" contains
JSX would be a guess, and this package does not guess — tree-sitter's JavaScript grammar parses JSX anyway.

Framework-specific intelligence (Next.js routes, NestJS modules, Express routers) is deliberately out of
scope until the language-level system is solid.

## What the scanner excludes

Skipped directories by default: `node_modules`, `.git`, `dist`, `build`, `coverage`, `out`, `.next`,
`.nuxt`, `.svelte-kit`, `.output`, `.turbo`, `.cache`, `.parcel-cache`, `.expo`, `.vercel`, `.netlify`,
`.yarn`, `.pnpm-store`, `.code-intelligence`. Skipped file patterns: `*.min.js`, `*.bundle.js`, `*.map`.

`.gitignore` is honoured, including nested `.gitignore` files scoped to their own subtree and negation
patterns. Files over 1 MiB are skipped. Symlinks are **not** followed by default; when enabled they are
re-validated against the project root after resolution, so a link cannot pull in files from outside.

Anything skipped for a reason worth knowing about (too large, symlink, outside root, unreadable, limit
reached) is reported rather than silently dropped. Routine exclusions are not listed individually — on a
large repository that list would dwarf the result.

## Parsing

Parsing uses the **native** tree-sitter bindings, not WASM. They ship N-API prebuilds for macOS, Linux
and Windows on x64 and arm64, so a plain `npx` install compiles nothing and needs no build toolchain, and
they track current grammar releases. (The readily available `.wasm` builds carry older grammars that
mis-parse modern TypeScript such as `accessor` fields.) Only two files import tree-sitter; everything
above them uses the normalized `syntax_node` type, so the backend stays replaceable.

**Parsing is error-tolerant.** A file with a syntax error still produces a usable tree plus a populated
`parse_errors` list — refusing to index a file because of one typo would lose far more than it protects.
Measured on a 650 KB `.d.ts` with 7 unparseable spots, the parser still recovered 265 interfaces, 77 type
aliases and 1,251 property signatures.

Two conventions are fixed at the parser boundary and hold everywhere above it:

- **Positions are 1-based** for both line and column, as editors display them. tree-sitter is 0-based;
  the conversion happens in exactly one place.
- **Offsets are JavaScript string indices** (UTF-16 code units), not byte offsets, so
  `source.slice(start_index, end_index)` is exact even for source containing emoji or accents. This was
  verified against non-ASCII input rather than assumed.

Nodes are wrapped lazily, so inspecting a few nodes in a large file does not materialize the whole tree,
and tree traversal uses an explicit stack so deeply nested source cannot overflow it.

### Known grammar limitations

These are limits of the upstream grammar, not of this package, and they degrade gracefully — the rest of
the file still parses:

- `abstract` used as a _property name_ (`interface x { abstract: boolean }`) fails to parse, because the
  grammar treats it as a reserved modifier. Other contextual keywords may behave the same way.
- Some ambient `export =` forms in `.d.cts` declaration files fail.

Measured on 4,313 real-world files (40.7 MB of source from `node_modules`): 0 hard failures, and 209
files (4.8%) reported at least one syntax issue, essentially all of them `.d.ts` files using the
constructs above.
