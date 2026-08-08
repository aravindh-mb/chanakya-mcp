# Code Model & AST Extraction

Between the raw Tree-Sitter grammar and the SQLite index sits a language-independent code intelligence model. It does not attempt to represent every syntactic token—instead, it extracts the exact facts and relationships that AI coding agents require.

<div class="custom-banner">
  <div class="custom-banner-icon">🧩</div>
  <div class="custom-banner-content">
    <h4>Language-Agnostic Relational Model</h4>
    <p>Decoupled from specific compiler backends. The normalization layer maps concrete syntax nodes into a uniform, queryable graph.</p>
  </div>
</div>

---

## The Normalized Data Entities

The code model defines six core record types:

| Entity | Attributes Recorded | Description |
| :--- | :--- | :--- |
| `code_file` | `path`, `language`, `size`, `hash`, `package` | File metadata and package affiliation (for monorepos). |
| `code_symbol` | `id`, `name`, `kind`, `location`, `parent_id`, `signature`, `export_kind` | Core declaration (function, class, method, etc.). |
| `relationship` | `source_id`, `target_id`, `target_name`, `kind`, `confidence` | Graph edge connecting two symbols or files. |
| `code_import` | `specifier`, `imported_name`, `local_name`, `resolved_path`, `is_package` | Static ES module or CommonJS import statement. |
| `code_export` | `name`, `local_name`, `source_path`, `is_reexport` | Exported identifier or re-exported barrel entry. |
| `code_reference`| `name`, `file_path`, `location`, `enclosing_symbol_id` | Every semantic occurrence of an identifier. |

---

## 9 Standard Symbol Kinds

```typescript
type SymbolKind =
  | 'function'   // Standalone function, arrow function, generator
  | 'class'      // ES6 class, abstract class
  | 'method'     // Class method, getter, setter
  | 'interface'  // TypeScript interface definition
  | 'type'       // Type alias (type Foo = ...)
  | 'variable'   // Top-level mutable variable (let, var)
  | 'constant'   // Top-level immutable constant (const)
  | 'enum'       // TypeScript enum declaration
  | 'module';    // Namespace, ambient module
```

---

## 7 Relational Graph Edge Kinds

```typescript
type RelationshipKind =
  | 'contains'    // Parent-child AST nesting (Class -> Method, Module -> Function)
  | 'imports'     // File pulls in symbol from another module
  | 'exports'     // Module exposes symbol to consumers
  | 'calls'       // Invocation edge (A calls B)
  | 'references'  // General semantic usage or type annotation
  | 'extends'     // Class inheritance or interface extension
  | 'implements'; // Class implements interface contract
```

---

## Core Extraction Principles

### 1. Zero Guesswork — Confidence Tiers
Codebrain MCP never fabricates a relationship. Edges carry strict confidence ratings:
- **`certain`**: Derived unambiguously from local syntax (e.g., `contains` parent-child relationships, explicit class method calls).
- **`resolved`**: Followed confidently across an explicit ES import binding.
- **Unresolved Calls**: When a call target cannot be determined statically (e.g., dynamic dispatch or ambiguous naming), the edge is stored with `target_name` and `target_id: null`. An agent never receives a misleading fabricated target.

### 2. Stable Symbol Identifiers
Symbol IDs are constructed without line numbers:
```text
<file_path>#<kind>:<container.path>
Example: src/services/user.ts#method:UserService.create_user
```
By excluding line numbers from symbol IDs, adding or deleting lines elsewhere in a file does not invalidate IDs across the rest of the codebase. This allows incremental indexing to diff modified files efficiently.

### 3. Pragmatic Extraction Rules
- **Arrow Functions as Functions:** `const handleRequest = () => {}` is recorded as a `function`, matching modern React and TypeScript conventions.
- **Exclusion of Function-Local Noise:** Transient local variables (`i`, `temp`, `stack`, `curr`) inside function bodies are excluded from the symbol index to prevent cluttering search results. Nested functions and classes declared inside functions are preserved.
- **Anonymous Default Exports:** `export default function() {}` is indexed under the canonical name `default`.
