/**
 * Recursive project scanner.
 *
 * Produces normalized metadata for every supported source file inside the
 * project root. It deliberately never reads file contents: parsing is Phase 3's
 * job, and keeping the scan to directory entries plus `stat` keeps it fast and
 * memory-flat on large repositories.
 *
 * Safety properties (the foundation of Phase 18):
 * - nothing outside `root_path` is ever returned, even via symlinks
 * - symlinks are skipped by default and containment-checked when enabled
 * - a file has one canonical identity: symlinked targets are reported under the
 *   real path, so an alias can never shadow or duplicate the real file
 * - symlink cycles cannot hang the scan (visited real paths + depth cap)
 * - unreadable directories are reported, not fatal, and never abort the scan
 */

import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Dirent } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { code_intelligence_error, describe_unknown_error } from '../core/errors.js';
import { to_posix_path, to_relative_posix_path } from '../core/paths.js';
import {
  DEFAULT_IGNORED_DIRECTORIES,
  DEFAULT_IGNORE_PATTERNS,
  create_pattern_layer,
  is_ignored,
  load_ignore_layer,
  type ignore_layer,
} from './ignore_rules.js';
import { detect_language, get_extension } from './language.js';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  type scan_event,
  type scan_options,
  type scan_result,
  type scanned_file,
  type skip_reason,
  type skipped_entry,
} from './types.js';

interface resolved_scan_settings {
  readonly root_path: string;
  readonly max_file_size_bytes: number;
  readonly follow_symlinks: boolean;
  readonly respect_gitignore: boolean;
  readonly ignored_directory_names: ReadonlySet<string>;
  readonly ignore_patterns: readonly string[];
  readonly max_files: number;
  readonly max_depth: number;
}

interface walk_state {
  files_emitted: number;
  /** Real directory paths already visited, so symlink loops terminate. */
  readonly visited_directories: Set<string>;
  /**
   * Real file paths already emitted. Only populated when `follow_symlinks` is
   * on, since without symlinks a file cannot be reached twice; this keeps the
   * default scan's memory flat in the number of files.
   */
  readonly visited_files: Set<string>;
  stopped: boolean;
}

/**
 * Scan the project and collect every result in memory.
 * Use `walk_project` instead when the caller can process files incrementally.
 */
export async function scan_project(options: scan_options): Promise<scan_result> {
  const started_at = Date.now();
  const files: scanned_file[] = [];
  const skipped: skipped_entry[] = [];
  let directories_scanned = 0;

  for await (const event of walk_project(options)) {
    switch (event.type) {
      case 'file':
        files.push(event.file);
        break;
      case 'skipped':
        skipped.push(event.entry);
        break;
      case 'directory':
        directories_scanned += 1;
        break;
    }
  }

  return {
    root_path: options.root_path,
    files,
    skipped,
    stats: {
      directories_scanned,
      files_matched: files.length,
      files_skipped: skipped.length,
      duration_ms: Date.now() - started_at,
    },
  };
}

/** Stream scan events depth-first, in sorted order for deterministic output. */
export async function* walk_project(options: scan_options): AsyncGenerator<scan_event> {
  const settings = resolve_settings(options);
  const state: walk_state = {
    files_emitted: 0,
    visited_directories: new Set(),
    visited_files: new Set(),
    stopped: false,
  };

  const base_layers: ignore_layer[] = [];
  const pattern_layer = create_pattern_layer(settings.ignore_patterns);
  if (pattern_layer !== undefined) {
    base_layers.push(pattern_layer);
  }

  yield* walk_directory(settings.root_path, '', 0, base_layers, settings, state);
}

function resolve_settings(options: scan_options): resolved_scan_settings {
  if (!isAbsolute(options.root_path)) {
    throw new code_intelligence_error({
      code: 'invalid_project_root',
      message: `The scanner requires an absolute project root, received: ${options.root_path}`,
      hint: 'Pass the value produced by resolve_project_root().',
    });
  }

  const ignored_directories = options.ignored_directories ?? DEFAULT_IGNORED_DIRECTORIES;

  return {
    root_path: resolve(options.root_path),
    max_file_size_bytes: options.max_file_size_bytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
    follow_symlinks: options.follow_symlinks ?? false,
    respect_gitignore: options.respect_gitignore ?? true,
    ignored_directory_names: new Set(ignored_directories.map((name) => name.toLowerCase())),
    ignore_patterns: options.ignore_patterns ?? DEFAULT_IGNORE_PATTERNS,
    max_files: options.max_files ?? Number.POSITIVE_INFINITY,
    max_depth: options.max_depth ?? DEFAULT_MAX_DEPTH,
  };
}

async function* walk_directory(
  directory_path: string,
  relative_directory_path: string,
  depth: number,
  inherited_layers: readonly ignore_layer[],
  settings: resolved_scan_settings,
  state: walk_state,
): AsyncGenerator<scan_event> {
  if (state.stopped) {
    return;
  }

  // Every path reaching this function is already symlink-resolved: the root is
  // resolved by the caller, plain subdirectories inherit that, and symlinked
  // directories are realpath'd before recursing. Recording them therefore makes
  // symlink cycles terminate and prevents the same directory being walked twice
  // through two different links.
  if (state.visited_directories.has(directory_path)) {
    return;
  }
  state.visited_directories.add(directory_path);

  if (depth > settings.max_depth) {
    yield skip_event(
      relative_directory_path,
      'max_depth_exceeded',
      `Directory nesting exceeded ${settings.max_depth} levels.`,
    );
    return;
  }

  const entries = await read_directory_entries(directory_path);
  if (entries === undefined) {
    yield skip_event(relative_directory_path, 'unreadable', 'Directory could not be read.');
    return;
  }

  yield { type: 'directory', relative_path: relative_directory_path === '' ? '.' : relative_directory_path };

  const layers = settings.respect_gitignore
    ? await extend_with_gitignore(inherited_layers, directory_path, relative_directory_path)
    : inherited_layers;

  for (const entry of entries) {
    if (state.stopped) {
      return;
    }

    const entry_path = join(directory_path, entry.name);
    const entry_relative_path =
      relative_directory_path === '' ? to_posix_path(entry.name) : `${relative_directory_path}/${entry.name}`;

    if (entry.isSymbolicLink()) {
      yield* handle_symlink(entry_path, entry_relative_path, depth, layers, settings, state);
      continue;
    }

    if (entry.isDirectory()) {
      if (should_skip_directory(entry.name, entry_relative_path, layers, settings)) {
        continue;
      }
      yield* walk_directory(entry_path, entry_relative_path, depth + 1, layers, settings, state);
      continue;
    }

    if (entry.isFile()) {
      yield* handle_file(entry_path, entry_relative_path, layers, settings, state);
    }
    // Sockets, FIFOs and devices are not source files and are ignored silently.
  }
}

async function* handle_file(
  file_path: string,
  relative_path: string,
  layers: readonly ignore_layer[],
  settings: resolved_scan_settings,
  state: walk_state,
): AsyncGenerator<scan_event> {
  const language = detect_language(file_path);
  if (language === undefined) {
    return;
  }
  if (is_ignored(layers, relative_path, false)) {
    return;
  }

  if (settings.follow_symlinks) {
    if (state.visited_files.has(file_path)) {
      return;
    }
    state.visited_files.add(file_path);
  }

  if (state.files_emitted >= settings.max_files) {
    state.stopped = true;
    yield skip_event(relative_path, 'max_files_reached', `Scan stopped after ${settings.max_files} files.`);
    return;
  }

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(file_path);
  } catch (error: unknown) {
    yield skip_event(
      relative_path,
      'unreadable',
      `File could not be inspected: ${describe_unknown_error(error)}`,
    );
    return;
  }

  if (stats.size > settings.max_file_size_bytes) {
    yield skip_event(
      relative_path,
      'too_large',
      `File is ${stats.size} bytes, over the ${settings.max_file_size_bytes} byte limit.`,
    );
    return;
  }

  state.files_emitted += 1;
  yield {
    type: 'file',
    file: {
      file_path,
      relative_path,
      extension: get_extension(file_path),
      language,
      size: stats.size,
      modified_time: stats.mtimeMs,
    },
  };
}

/**
 * Symlinks are the main way a scan can escape the project root or loop forever,
 * so they are opt-in and revalidated against the root after resolution.
 */
async function* handle_symlink(
  link_path: string,
  relative_path: string,
  depth: number,
  layers: readonly ignore_layer[],
  settings: resolved_scan_settings,
  state: walk_state,
): AsyncGenerator<scan_event> {
  if (!settings.follow_symlinks) {
    yield skip_event(
      relative_path,
      'symlink',
      'Symlinks are not followed. Enable follow_symlinks to include it.',
    );
    return;
  }

  let real_path: string;
  try {
    real_path = await realpath(link_path);
  } catch (error: unknown) {
    yield skip_event(
      relative_path,
      'unreadable',
      `Symlink could not be resolved: ${describe_unknown_error(error)}`,
    );
    return;
  }

  const resolved_relative_path = to_relative_posix_path(settings.root_path, real_path);
  // `to_relative_posix_path` returns '.' for the root; the walker uses '' for it.
  const canonical_relative_path = resolved_relative_path === '.' ? '' : resolved_relative_path;
  if (canonical_relative_path === undefined) {
    yield skip_event(
      relative_path,
      'outside_root',
      `Symlink target resolves outside the project root: ${real_path}`,
    );
    return;
  }

  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(real_path);
  } catch (error: unknown) {
    yield skip_event(
      relative_path,
      'unreadable',
      `Symlink target could not be inspected: ${describe_unknown_error(error)}`,
    );
    return;
  }

  // Report the target under its canonical path, not the link's. A file inside
  // the root has exactly one identity in the index; a symlink is a shortcut to
  // it, not a second file. Without this an alias could shadow the real path and
  // an agent looking up the real path would be told it does not exist.
  if (stats.isDirectory()) {
    const directory_name = canonical_relative_path.slice(canonical_relative_path.lastIndexOf('/') + 1);
    if (should_skip_directory(directory_name, canonical_relative_path, layers, settings)) {
      return;
    }
    yield* walk_directory(real_path, canonical_relative_path, depth + 1, layers, settings, state);
    return;
  }

  if (stats.isFile()) {
    yield* handle_file(real_path, canonical_relative_path, layers, settings, state);
  }
}

function should_skip_directory(
  directory_name: string,
  relative_path: string,
  layers: readonly ignore_layer[],
  settings: resolved_scan_settings,
): boolean {
  if (settings.ignored_directory_names.has(directory_name.toLowerCase())) {
    return true;
  }
  return is_ignored(layers, relative_path, true);
}

async function extend_with_gitignore(
  inherited_layers: readonly ignore_layer[],
  directory_path: string,
  relative_directory_path: string,
): Promise<readonly ignore_layer[]> {
  const layer = await load_ignore_layer(directory_path, relative_directory_path);
  if (layer === undefined) {
    return inherited_layers;
  }
  return [...inherited_layers, layer];
}

async function read_directory_entries(directory_path: string): Promise<Dirent[] | undefined> {
  try {
    const entries = await readdir(directory_path, { withFileTypes: true });
    // Sorted so scan output is deterministic across platforms and runs.
    return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  } catch {
    return undefined;
  }
}

function skip_event(relative_path: string, reason: skip_reason, detail: string): scan_event {
  return {
    type: 'skipped',
    entry: { relative_path: relative_path === '' ? '.' : relative_path, reason, detail },
  };
}
