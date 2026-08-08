/**
 * Regression tests for the path-containment rule that protects every edit tool.
 *
 * The invariant under test: no caller-supplied path can make an edit tool
 * address a file outside the project root. `resolve_project_path` is the single
 * choke point, so it is exercised with crafted inputs (dot segments, absolute
 * forms, encoding tricks) and with symlinks that point outside the root, which
 * are invisible to a purely lexical containment check.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { is_path_inside } from '../../src/core/paths.js';
import { apply_patch } from '../../src/edit/apply_patch.js';
import { resolve_project_path } from '../../src/edit/project_file.js';
import { tool_error } from '../../src/mcp/errors.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, detect_symlink_support, type temp_project } from '../helpers/temp_project.js';

let project: temp_project;
let outside_dir: string | undefined;

beforeEach(() => {
  project = create_temp_project();
  outside_dir = undefined;
});

afterEach(() => {
  project.cleanup();
  if (outside_dir !== undefined) {
    rmSync(outside_dir, { recursive: true, force: true });
  }
});

function make_outside_dir(): string {
  outside_dir = mkdtempSync(join(tmpdir(), 'code-intelligence-outside-'));
  return outside_dir;
}

describe('resolve_project_path traversal', () => {
  it('refuses every crafted path: it either throws or resolves inside the root', () => {
    const attacks = [
      '../evil.ts',
      'a/../../evil.ts',
      'a/../b/../../evil.ts',
      'sub/../evil.ts',
      'a/..',
      'a/../',
      '..././../evil.ts',
      '..%2Fevil.ts',
      '..%5Cevil.ts',
      '..\\..\\evil.ts',
      '..../evil.ts',
      'C:/evil.ts',
      'C:\\evil.ts',
      '/evil.ts',
      '\\\\server\\share\\evil.ts',
      'a/',
      'a//b/./c.ts',
    ];

    for (const attack of attacks) {
      let resolved: string | undefined;
      let thrown = false;
      try {
        resolved = resolve_project_path(project.root_path, attack);
      } catch (error) {
        expect(error).toBeInstanceOf(tool_error);
        thrown = true;
      }
      if (!thrown) {
        expect(resolved).toBeDefined();
        expect(is_path_inside(project.root_path, resolved as string)).toBe(true);
      }
    }
  });

  it('rejects a bare .. segment that stays inside the project', () => {
    project.make_directory('a');
    project.write_file('a/file.ts', 'x');
    expect(() => resolve_project_path(project.root_path, 'a/../a/file.ts')).toThrow(tool_error);
  });

  it('accepts a plain in-project path unchanged', () => {
    project.write_file('src/lib/util.ts', 'x');
    const resolved = resolve_project_path(project.root_path, 'src/lib/util.ts');
    expect(is_path_inside(project.root_path, resolved)).toBe(true);
  });
});

const symlink_support = detect_symlink_support();
const it_with_dir_links = it.skipIf(!symlink_support.directories);
const it_with_file_links = it.skipIf(!symlink_support.files);

describe('resolve_project_path symlink escape', () => {
  it_with_dir_links('refuses a path through a directory link that points outside', () => {
    const outside = make_outside_dir();
    project.create_symlink('escape', outside, 'dir');

    expect(() => resolve_project_path(project.root_path, 'escape/evil.ts')).toThrow(/outside the project/);
    expect(() => resolve_project_path(project.root_path, 'escape')).toThrow(/outside the project/);
  });

  it_with_dir_links('allows a directory link that stays inside the project', () => {
    project.write_file('src/file.ts', 'x');
    project.create_symlink('alias', project.resolve_path('src'), 'dir');

    expect(() => resolve_project_path(project.root_path, 'alias/file.ts')).not.toThrow();
  });

  it_with_file_links('refuses a file link that points outside', () => {
    const outside = make_outside_dir();
    writeFileSync(join(outside, 'evil.txt'), 'x', 'utf8');
    project.create_symlink('evil.txt', join(outside, 'evil.txt'), 'file');

    expect(() => resolve_project_path(project.root_path, 'evil.txt')).toThrow(/outside the project/);
  });

  it_with_dir_links('apply_patch refuses to write through a directory link', async () => {
    const outside = make_outside_dir();
    const victim = join(outside, 'victim.ts');
    writeFileSync(victim, 'old', 'utf8');
    project.create_symlink('escape', outside, 'dir');

    const store = index_store.open({ data_dir_path: '', project_root: project.root_path, in_memory: true });
    try {
      await expect(
        apply_patch({
          store,
          root_path: project.root_path,
          reindex: async () => {
            throw new Error('reindex must not run when the write is refused');
          },
          path: 'escape/victim.ts',
          edits: [{ old_text: 'old', new_text: 'new' }],
        }),
      ).rejects.toBeInstanceOf(tool_error);
    } finally {
      store.close();
    }

    expect(readFileSync(victim, 'utf8')).toBe('old');
  });
});
