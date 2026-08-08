import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { code_intelligence_error } from '../../src/core/errors.js';
import { DATA_DIR_NAME, resolve_project_root } from '../../src/core/project_root.js';

let temp_dir: string;
let nested_dir: string;
let file_path: string;

beforeAll(() => {
  temp_dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'code-intelligence-')));
  nested_dir = join(temp_dir, 'apps', 'api');
  file_path = join(temp_dir, 'readme.txt');

  writeFileSync(file_path, 'hello', 'utf8');
  mkdirSync(nested_dir, { recursive: true });
});

afterAll(() => {
  rmSync(temp_dir, { recursive: true, force: true });
});

describe('resolve_project_root', () => {
  it('defaults to the current working directory', () => {
    const root = resolve_project_root({ cwd: temp_dir });

    expect(root.root_path).toBe(temp_dir);
  });

  it('derives the data directory inside the project', () => {
    const root = resolve_project_root({ cwd: temp_dir });

    expect(root.data_dir_path).toBe(join(temp_dir, DATA_DIR_NAME));
    expect(root.data_dir_path.startsWith(root.root_path + sep)).toBe(true);
  });

  it('accepts an absolute path', () => {
    expect(resolve_project_root({ input_path: nested_dir }).root_path).toBe(nested_dir);
  });

  it('resolves a relative path against cwd', () => {
    const root = resolve_project_root({ input_path: './apps/api', cwd: temp_dir });

    expect(root.root_path).toBe(resolve(temp_dir, 'apps', 'api'));
  });

  it('resolves ".." segments', () => {
    const root = resolve_project_root({ input_path: 'apps/api/../..', cwd: temp_dir });

    expect(root.root_path).toBe(temp_dir);
  });

  it('rejects a path that does not exist', () => {
    const missing = join(temp_dir, 'does-not-exist');

    expect(() => resolve_project_root({ input_path: missing })).toThrowError(code_intelligence_error);
    try {
      resolve_project_root({ input_path: missing });
      expect.unreachable('resolve_project_root should have thrown');
    } catch (error: unknown) {
      expect((error as code_intelligence_error).code).toBe('project_root_not_found');
    }
  });

  it('rejects a file', () => {
    try {
      resolve_project_root({ input_path: file_path });
      expect.unreachable('resolve_project_root should have thrown');
    } catch (error: unknown) {
      expect((error as code_intelligence_error).code).toBe('project_root_not_directory');
      expect((error as code_intelligence_error).message).toContain('not a directory');
    }
  });

  it('rejects an empty path', () => {
    try {
      resolve_project_root({ input_path: '   ' });
      expect.unreachable('resolve_project_root should have thrown');
    } catch (error: unknown) {
      expect((error as code_intelligence_error).code).toBe('invalid_project_root');
    }
  });
});
