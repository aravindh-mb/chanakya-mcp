import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { is_path_inside, to_posix_path, to_relative_posix_path } from '../../src/core/paths.js';

const root = resolve('/projects/app');

describe('to_posix_path', () => {
  it('converts native separators to forward slashes', () => {
    expect(to_posix_path(['src', 'core', 'a.ts'].join(sep))).toBe('src/core/a.ts');
  });

  it('leaves posix paths untouched', () => {
    expect(to_posix_path('src/core/a.ts')).toBe('src/core/a.ts');
  });
});

describe('is_path_inside', () => {
  it('accepts the root itself', () => {
    expect(is_path_inside(root, root)).toBe(true);
  });

  it('accepts a nested path', () => {
    expect(is_path_inside(root, resolve(root, 'src/index.ts'))).toBe(true);
  });

  it('rejects the parent directory', () => {
    expect(is_path_inside(root, resolve('/projects'))).toBe(false);
  });

  it('rejects a sibling with the root as a string prefix', () => {
    // The classic containment bug: "/projects/app-secrets" starts with "/projects/app".
    expect(is_path_inside(root, resolve('/projects/app-secrets/file.ts'))).toBe(false);
  });

  it('rejects a traversal escape', () => {
    expect(is_path_inside(root, resolve(root, '../../etc/passwd'))).toBe(false);
  });

  it('accepts a traversal that stays inside', () => {
    expect(is_path_inside(root, resolve(root, 'src/../src/index.ts'))).toBe(true);
  });

  it('rejects relative paths outright', () => {
    expect(is_path_inside(root, 'src/index.ts')).toBe(false);
    expect(is_path_inside('projects/app', resolve(root, 'src/index.ts'))).toBe(false);
  });

  it('tolerates a trailing separator on the root', () => {
    expect(is_path_inside(root + sep, resolve(root, 'src/index.ts'))).toBe(true);
  });
});

describe('to_relative_posix_path', () => {
  it('produces a posix path relative to the root', () => {
    expect(to_relative_posix_path(root, resolve(root, 'src/core/a.ts'))).toBe('src/core/a.ts');
  });

  it('returns "." for the root itself', () => {
    expect(to_relative_posix_path(root, root)).toBe('.');
  });

  it('returns undefined for paths outside the root', () => {
    expect(to_relative_posix_path(root, resolve('/elsewhere/a.ts'))).toBeUndefined();
  });
});
