# Scanning & Language Grammars

Chanakya MCP features a high-performance repository scanner paired with **native Tree-Sitter grammars**. It parses files into concrete syntax trees without spawning separate compiler processes.

<div class="custom-banner">
  <div class="custom-banner-icon">âš¡</div>
  <div class="custom-banner-content">
    <h4>Native N-API Prebuilds</h4>
    <p>Zero WASM overhead. Codebrain ships native precompiled Tree-Sitter binaries across macOS, Linux, and Windows for both x64 and arm64 architectures.</p>
  </div>
</div>

---

## Supported Languages & Grammars

Language detection is deterministic and based on file extension:

| Language | Extensions | Detection | AST Parser | Grammar Package |
| :--- | :--- | :--- | :--- | :--- |
| **JavaScript** | `.js`, `.mjs`, `.cjs` | Extension | Tree-Sitter | `tree-sitter-javascript` |
| **JSX** | `.jsx` | Extension | Tree-Sitter | `tree-sitter-javascript` |
| **TypeScript** | `.ts`, `.mts`, `.cts`, `.d.ts` | Extension | Tree-Sitter | `tree-sitter-typescript` |
| **TSX** | `.tsx` | Extension | Tree-Sitter | `tree-sitter-typescript` (tsx dialect) |

::: tip GRAMMAR SEPARATION
Tree-Sitter's JavaScript grammar parses JSX natively. However, TypeScript requires separate grammars for `.ts` vs `.tsx` due to syntactic ambiguities with generic type arguments (`<T>() => ...`) vs JSX tags (`<T>...</T>`). Codebrain selects the exact grammar variant automatically.
:::

---

## Native Parsing vs WASM

Many web-based or JavaScript tools rely on `web-tree-sitter` (WASM). Codebrain intentionally uses native **N-API bindings**:

- **No compilation step:** Prebuilt binaries run immediately with `npx`.
- **Modern TypeScript features:** Parses modern constructs such as `accessor` keywords, stage-3 decorators, and `using` declarations without failing.
- **Raw Throughput:** Parses over **115+ files per second**, indexing a 100-file repository in under 250ms.

---

## Error-Tolerant AST Recovery

Real-world codebases often have syntax errors, uncommitted merge conflicts, or incomplete edits. 

**Codebrain never abandons a file due to syntax errors.** The parser performs error-tolerant node recovery:

```typescript
// A file containing an unparseable typo still yields its valid AST declarations:
interface ValidUser {
  id: string;
  name: string;
}

// Typo syntax spot:
function broken( {

// Valid downstream declaration recovered:
export class AccountService {
  public getBalance(): number { return 100; }
}
```

> **Stress Test Result:** Evaluated against a 650 KB `.d.ts` file containing 7 unparseable constructs, the parser successfully recovered **265 interfaces, 77 type aliases, and 1,251 property signatures**.

---

## Coordinate & Offset Guarantees

To ensure complete compatibility with AI agents and code editors, Codebrain normalizes all coordinates at the parser boundary:

1. **1-Based Line & Column:** Converted from Tree-Sitter's 0-based format to standard 1-based editor coordinates.
2. **UTF-16 Code Unit String Offsets:** String slicing (`source.slice(start_offset, end_offset)`) operates on JavaScript code units, ensuring exact character slicing even when files contain emojis, multi-byte Unicode characters, or international text.

---

## Scanner Ignore Rules & Exclusions

The file scanner automatically honors repository ignore rules:

- **Recursive `.gitignore` Support:** Accurately evaluates nested `.gitignore` files within subdirectories, including negative negation patterns (`!keep.js`).
- **Default Skipped Folders:** `node_modules`, `.git`, `dist`, `build`, `coverage`, `out`, `.next`, `.nuxt`, `.turbo`, `.cache`, `.yarn`, `.pnpm-store`, `.chanakya`.
- **Minified Files & Bundles:** Automatically ignores `*.min.js`, `*.bundle.js`, and `*.map`.
- **File Size Cap:** Skips files exceeding 1 MiB to prevent heap saturation.
- **Symlink Sandbox:** Symlinks are not followed outside the project root; all resolved targets are validated with realpath containment checks.

