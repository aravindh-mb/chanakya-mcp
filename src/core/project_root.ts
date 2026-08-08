/**
 * Resolution and validation of the project root directory.
 *
 * Every later phase (scanner, indexer, MCP tools, patching) treats the value
 * returned here as the single trusted boundary: nothing outside of it may be
 * read or written. Resolving symlinks here means path containment checks added
 * in later phases compare real paths against a real path.
 */

import { statSync, realpathSync, type Stats } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { code_intelligence_error } from './errors.js';

/** Directory created inside the project for the local index and caches. */
export const DATA_DIR_NAME = '.code-intelligence';

export interface project_root {
  /** Absolute, symlink-resolved path to the project root. */
  readonly root_path: string;
  /** Absolute path to `<root>/.code-intelligence`. Not created yet. */
  readonly data_dir_path: string;
}

export interface resolve_project_root_options {
  /** Raw path from the CLI. May be relative, may be undefined. */
  readonly input_path?: string | undefined;
  /** Directory relative paths are resolved against. Defaults to `process.cwd()`. */
  readonly cwd?: string;
}

export function resolve_project_root(options: resolve_project_root_options = {}): project_root {
  const cwd = options.cwd ?? process.cwd();
  const input_path = options.input_path;

  if (input_path !== undefined && input_path.trim() === '') {
    throw new code_intelligence_error({
      code: 'invalid_project_root',
      message: 'The project path is empty.',
      hint: 'Pass a directory, for example: code-intelligence-mcp ./my-app',
    });
  }

  const absolute_path =
    input_path === undefined
      ? resolve(cwd)
      : isAbsolute(input_path)
        ? resolve(input_path)
        : resolve(cwd, input_path);

  const stats = stat_or_throw(absolute_path);

  if (!stats.isDirectory()) {
    throw new code_intelligence_error({
      code: 'project_root_not_directory',
      message: `The project path is not a directory: ${absolute_path}`,
      hint: 'Point the CLI at the root folder of your project, not at a file.',
    });
  }

  const root_path = real_path_or_throw(absolute_path);

  return {
    root_path,
    data_dir_path: resolve(root_path, DATA_DIR_NAME),
  };
}

function stat_or_throw(absolute_path: string): Stats {
  try {
    return statSync(absolute_path);
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'project_root_not_found',
      message: `The project path does not exist: ${absolute_path}`,
      hint: 'Check the path, or run the command from inside your project.',
      cause,
    });
  }
}

function real_path_or_throw(absolute_path: string): string {
  try {
    return realpathSync.native(absolute_path);
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'invalid_project_root',
      message: `The project path could not be resolved: ${absolute_path}`,
      hint: 'A symlink in the path may be broken or unreadable.',
      cause,
    });
  }
}
