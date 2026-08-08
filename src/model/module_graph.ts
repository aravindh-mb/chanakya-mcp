/**
 * Imports, exports and references.
 *
 * These are kept separate from `relationship` because they carry information an
 * edge does not: an import has a module specifier that may never resolve to a
 * file in this project (`react`), and an export has a local name that can
 * differ from the exported name (`export { a as b }`).
 */

/**
 * How a name was brought into a file.
 *
 * - `named`:     `import { a } from 'm'`
 * - `default`:   `import a from 'm'`
 * - `namespace`: `import * as a from 'm'`
 * - `side_effect`: `import 'm'` — no binding at all
 * - `require`:   `const a = require('m')` in CommonJS
 * - `dynamic`:   `await import('m')` with a statically readable specifier
 */
export type import_kind = 'named' | 'default' | 'namespace' | 'side_effect' | 'require' | 'dynamic';

export interface code_import {
  readonly id: string;
  /** POSIX path of the importing file. */
  readonly file_path: string;
  readonly kind: import_kind;
  /** Exactly as written, e.g. `./user.service` or `@scope/pkg`. */
  readonly module_specifier: string;
  /** Name in the source module. Absent for namespace and side-effect imports. */
  readonly imported_name?: string | undefined;
  /** Name bound in this file. Differs from `imported_name` under aliasing. */
  readonly local_name?: string | undefined;
  /**
   * POSIX path of the resolved file, when the specifier resolves inside the
   * project. Absent for third-party packages and unresolvable specifiers —
   * both normal outcomes.
   */
  readonly resolved_path?: string | undefined;
  /** True when the specifier is relative or a workspace path, not a bare package. */
  readonly is_internal: boolean;
  readonly line: number;
}

/**
 * - `named`:     `export const a` / `export { a }`
 * - `default`:   `export default a`
 * - `re_export`: `export { a } from 'm'` / `export * from 'm'`
 */
export type export_kind_detail = 'named' | 'default' | 're_export';

export interface code_export {
  readonly id: string;
  readonly file_path: string;
  readonly kind: export_kind_detail;
  /** The name consumers import. `default` for default exports. */
  readonly exported_name: string;
  /** The declaration's own name, when it differs from `exported_name`. */
  readonly local_name?: string | undefined;
  /** Id of the exported symbol, when it is declared in this file. */
  readonly symbol_id?: string | undefined;
  /** Source module for re-exports. */
  readonly module_specifier?: string | undefined;
  readonly line: number;
}

/**
 * A mention of an identifier at a specific location.
 *
 * References are recorded per occurrence, including the declaration itself
 * (`is_definition`), so `find_references` can answer without re-parsing. A
 * reference whose `symbol_id` is absent is a name that was seen but not
 * resolved — recorded honestly rather than dropped or guessed.
 */
export interface code_reference {
  readonly id: string;
  readonly file_path: string;
  /** Identifier text as written. */
  readonly name: string;
  /** Resolved target, when known. */
  readonly symbol_id?: string | undefined;
  /** Symbol whose body encloses this reference, when there is one. */
  readonly enclosing_symbol_id?: string | undefined;
  readonly line: number;
  readonly column: number;
  readonly is_definition: boolean;
}

/** True for specifiers that point inside the project rather than at a package. */
export function is_internal_specifier(module_specifier: string): boolean {
  return (
    module_specifier.startsWith('./') ||
    module_specifier.startsWith('../') ||
    module_specifier === '.' ||
    module_specifier === '..' ||
    module_specifier.startsWith('/')
  );
}
