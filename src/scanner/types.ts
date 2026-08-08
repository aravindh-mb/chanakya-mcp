import type { language_id } from './language.js';

/** Normalized metadata for one source file found by the scanner. */
export interface scanned_file {
  /** Absolute native path. Used for filesystem access. */
  readonly file_path: string;
  /** POSIX path relative to the project root. Stable identifier across platforms. */
  readonly relative_path: string;
  /** Lowercased extension including the dot, e.g. `.ts`. */
  readonly extension: string;
  readonly language: language_id;
  /** Size in bytes. */
  readonly size: number;
  /** Last modification time, epoch milliseconds. */
  readonly modified_time: number;
}

/**
 * Why a file or directory was left out, for entries where silence would be
 * misleading. Routine exclusions (unsupported extension, ignore rules) are not
 * reported individually: on a large repository that list would dwarf the result.
 */
export type skip_reason =
  'too_large' | 'symlink' | 'outside_root' | 'unreadable' | 'max_depth_exceeded' | 'max_files_reached';

export interface skipped_entry {
  /** POSIX path relative to the project root where resolvable, else the absolute path. */
  readonly relative_path: string;
  readonly reason: skip_reason;
  /** Human readable explanation, safe to surface to an agent or user. */
  readonly detail: string;
}

export interface scan_stats {
  readonly directories_scanned: number;
  readonly files_matched: number;
  readonly files_skipped: number;
  readonly duration_ms: number;
}

export interface scan_result {
  readonly root_path: string;
  readonly files: readonly scanned_file[];
  readonly skipped: readonly skipped_entry[];
  readonly stats: scan_stats;
}

export interface scan_options {
  /** Absolute, symlink-resolved project root (from `resolve_project_root`). */
  readonly root_path: string;
  /** Files larger than this are skipped and reported. Default 1 MiB. */
  readonly max_file_size_bytes?: number;
  /** Follow symlinks that stay inside the root. Default `false`. */
  readonly follow_symlinks?: boolean;
  /** Honour `.gitignore` files. Default `true`. */
  readonly respect_gitignore?: boolean;
  /** Directory names never descended into. Defaults to `DEFAULT_IGNORED_DIRECTORIES`. */
  readonly ignored_directories?: readonly string[];
  /** Gitignore-syntax patterns, relative to the root. Defaults to `DEFAULT_IGNORE_PATTERNS`. */
  readonly ignore_patterns?: readonly string[];
  /** Stop after this many matched files. Default: unlimited. */
  readonly max_files?: number;
  /** Guard against pathological nesting and symlink loops. Default 32. */
  readonly max_depth?: number;
}

/**
 * Streaming output of `walk_project`. Emitting events instead of building an
 * array lets large repositories be processed without holding every result in
 * memory (see Phase 17).
 */
export type scan_event =
  | { readonly type: 'file'; readonly file: scanned_file }
  | { readonly type: 'skipped'; readonly entry: skipped_entry }
  | { readonly type: 'directory'; readonly relative_path: string };

export const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_DEPTH = 32;
