/**
 * Builds throwaway project trees on disk for scanner tests.
 *
 * Fixtures are created at run time rather than committed, because a committed
 * fixture containing `node_modules/` or `.gitignore` would be mangled by this
 * repository's own ignore rules.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface symlink_support {
  readonly files: boolean;
  readonly directories: boolean;
}

let cached_symlink_support: symlink_support | undefined;

/**
 * Probe what kinds of links this machine can create.
 *
 * Windows refuses file symlinks with EPERM unless Developer Mode or elevation is
 * on, while directory junctions always work. Tests use this to skip visibly
 * rather than returning early and reporting a pass they never performed.
 */
export function detect_symlink_support(): symlink_support {
  if (cached_symlink_support !== undefined) {
    return cached_symlink_support;
  }

  const probe_root = mkdtempSync(join(tmpdir(), 'code-intelligence-symlink-probe-'));
  const target_file = join(probe_root, 'target.txt');
  const target_directory = join(probe_root, 'target_dir');

  writeFileSync(target_file, '', 'utf8');
  mkdirSync(target_directory, { recursive: true });

  cached_symlink_support = {
    files: try_create_link(target_file, join(probe_root, 'file_link'), 'file'),
    directories: try_create_link(target_directory, join(probe_root, 'dir_link'), 'junction'),
  };

  rmSync(probe_root, { recursive: true, force: true });
  return cached_symlink_support;
}

function try_create_link(target_path: string, link_path: string, type: 'file' | 'junction'): boolean {
  try {
    symlinkSync(target_path, link_path, type);
    return true;
  } catch {
    return false;
  }
}

export interface temp_project {
  /** Absolute, symlink-resolved root of the generated tree. */
  readonly root_path: string;
  /** Absolute path for a project-relative POSIX path. */
  resolve_path(relative_path: string): string;
  write_file(relative_path: string, content: string): void;
  make_directory(relative_path: string): void;
  /**
   * Create a link. Throws on failure: callers must gate on
   * `detect_symlink_support()` so an unsupported platform skips the test
   * visibly rather than passing without exercising anything.
   */
  create_symlink(relative_link_path: string, target_path: string, type: 'file' | 'dir'): void;
  cleanup(): void;
}

/**
 * @param files map of project-relative POSIX paths to file contents.
 */
export function create_temp_project(files: Readonly<Record<string, string>> = {}): temp_project {
  const root_path = realpathSync.native(mkdtempSync(join(tmpdir(), 'code-intelligence-scan-')));

  const resolve_path = (relative_path: string): string => join(root_path, ...relative_path.split('/'));

  const write_file = (relative_path: string, content: string): void => {
    const absolute_path = resolve_path(relative_path);
    mkdirSync(dirname(absolute_path), { recursive: true });
    writeFileSync(absolute_path, content, 'utf8');
  };

  for (const [relative_path, content] of Object.entries(files)) {
    write_file(relative_path, content);
  }

  return {
    root_path,
    resolve_path,
    write_file,
    make_directory: (relative_path: string): void => {
      mkdirSync(resolve_path(relative_path), { recursive: true });
    },
    create_symlink: (relative_link_path: string, target_path: string, type: 'file' | 'dir'): void => {
      const link_path = resolve_path(relative_link_path);
      mkdirSync(dirname(link_path), { recursive: true });
      symlinkSync(target_path, link_path, type === 'dir' ? 'junction' : 'file');
    },
    cleanup: (): void => {
      rmSync(root_path, { recursive: true, force: true });
    },
  };
}
