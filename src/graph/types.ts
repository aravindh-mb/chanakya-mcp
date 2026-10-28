/**
 * Result shapes for module-graph queries.
 *
 * The graph answers two questions that navigation does not: what does a file
 * import (`get_dependencies`) and what imports it (`get_dependents`). The
 * answers are module-level — files and packages — rather than symbol-level,
 * and never include file contents.
 */

export interface dependency_hit {
  /**
   * The resolved project file (POSIX path) when the import points inside the
   * project, otherwise the module specifier exactly as written.
   */
  readonly target: string;
  /** True when the specifier is relative or workspace-scoped, not a bare package. */
  readonly is_internal: boolean;
  /** True when the import resolved to a file in the project. */
  readonly resolved: boolean;
  /** Names bound in the importing file, deduplicated across import lines. */
  readonly local_names: readonly string[];
  /** The module specifiers as written, deduplicated. */
  readonly specifiers: readonly string[];
  /** Line of the first import of this target. */
  readonly line: number;
}

export interface dependencies_result {
  readonly dependencies: readonly dependency_hit[];
}

export interface dependent_hit {
  readonly file_path: string;
  /**
   * `import` when the file binds names from the target; `re_export` when it
   * forwards the target's exports without importing anything itself.
   */
  readonly kind: 'import' | 're_export';
  /** Names bound from the target by direct imports, deduplicated. */
  readonly local_names: readonly string[];
  /** The module specifiers as written, deduplicated. */
  readonly specifiers: readonly string[];
  /** Line of the first import or re-export of the target. */
  readonly line: number;
  /**
   * Set when the file reaches the target through a re-exporting barrel rather
   * than importing it directly: the barrel it imports from. Present only when
   * the file binds a name the target itself exports, or the whole module.
   */
  readonly via?: string;
}

export interface dependents_result {
  readonly dependents: readonly dependent_hit[];
}
