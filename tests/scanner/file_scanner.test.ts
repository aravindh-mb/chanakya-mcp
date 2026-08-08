import { afterEach, describe, expect, it } from 'vitest';
import { code_intelligence_error } from '../../src/core/errors.js';
import { scan_project, walk_project } from '../../src/scanner/file_scanner.js';
import type { scan_options, scanned_file } from '../../src/scanner/types.js';
import { create_temp_project, detect_symlink_support, type temp_project } from '../helpers/temp_project.js';

let project: temp_project | undefined;

afterEach(() => {
  project?.cleanup();
  project = undefined;
});

function make_project(files: Readonly<Record<string, string>>): temp_project {
  project = create_temp_project(files);
  return project;
}

async function scan(root_path: string, overrides: Partial<scan_options> = {}): Promise<string[]> {
  const result = await scan_project({ root_path, ...overrides });
  return result.files.map((file) => file.relative_path);
}

const MONOREPO_FILES: Readonly<Record<string, string>> = {
  'package.json': '{"name":"root"}',
  'apps/web/src/App.tsx': 'export const App = () => null;\n',
  'apps/web/src/main.jsx': 'console.log("web");\n',
  'apps/api/src/server.ts': 'export const server = 1;\n',
  'apps/api/src/legacy.cjs': 'module.exports = {};\n',
  'apps/api/src/esm.mjs': 'export default 1;\n',
  'packages/ui/index.ts': 'export const ui = 1;\n',
  'packages/ui/README.md': '# ui\n',
  'packages/database/schema.d.ts': 'export declare const schema: number;\n',
};

describe('scan_project', () => {
  it('finds every supported source file in a monorepo layout', async () => {
    const temp = make_project(MONOREPO_FILES);

    expect(await scan(temp.root_path)).toEqual([
      'apps/api/src/esm.mjs',
      'apps/api/src/legacy.cjs',
      'apps/api/src/server.ts',
      'apps/web/src/App.tsx',
      'apps/web/src/main.jsx',
      'packages/database/schema.d.ts',
      'packages/ui/index.ts',
    ]);
  });

  it('excludes files with unsupported extensions', async () => {
    const temp = make_project(MONOREPO_FILES);
    const paths = await scan(temp.root_path);

    expect(paths).not.toContain('package.json');
    expect(paths).not.toContain('packages/ui/README.md');
  });

  it('returns normalized metadata for each file', async () => {
    const temp = make_project({ 'src/index.ts': 'export const a = 1;\n' });
    const result = await scan_project({ root_path: temp.root_path });
    const file = result.files[0] as scanned_file;

    expect(file.relative_path).toBe('src/index.ts');
    expect(file.file_path).toBe(temp.resolve_path('src/index.ts'));
    expect(file.extension).toBe('.ts');
    expect(file.language).toBe('typescript');
    expect(file.size).toBe(20);
    expect(file.modified_time).toBeGreaterThan(0);
  });

  it('always reports relative paths with forward slashes', async () => {
    const temp = make_project({ 'deeply/nested/dir/file.ts': 'export {};\n' });
    const [relative_path] = await scan(temp.root_path);

    expect(relative_path).toBe('deeply/nested/dir/file.ts');
    expect(relative_path).not.toContain('\\');
  });

  it('reports scan statistics', async () => {
    const temp = make_project(MONOREPO_FILES);
    const result = await scan_project({ root_path: temp.root_path });

    expect(result.root_path).toBe(temp.root_path);
    expect(result.stats.files_matched).toBe(7);
    expect(result.stats.directories_scanned).toBeGreaterThan(1);
    expect(result.stats.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('produces deterministic, sorted output', async () => {
    const temp = make_project(MONOREPO_FILES);

    expect(await scan(temp.root_path)).toEqual(await scan(temp.root_path));
  });
});

describe('scan_project ignore rules', () => {
  it('never descends into the default ignored directories', async () => {
    const temp = make_project({
      'src/index.ts': 'export {};\n',
      'node_modules/lodash/index.js': 'module.exports = {};\n',
      'dist/bundle.js': 'var a=1;\n',
      'build/output.js': 'var a=1;\n',
      'coverage/report.js': 'var a=1;\n',
      '.git/hooks/pre-commit.js': 'var a=1;\n',
      '.code-intelligence/cache.js': 'var a=1;\n',
      '.next/static/chunk.js': 'var a=1;\n',
    });

    expect(await scan(temp.root_path)).toEqual(['src/index.ts']);
  });

  it('ignores nested node_modules inside workspace packages', async () => {
    const temp = make_project({
      'packages/ui/index.ts': 'export {};\n',
      'packages/ui/node_modules/react/index.js': 'module.exports = {};\n',
    });

    expect(await scan(temp.root_path)).toEqual(['packages/ui/index.ts']);
  });

  it('excludes minified bundles by default', async () => {
    const temp = make_project({
      'src/app.js': 'const a = 1;\n',
      'public/vendor.min.js': 'var a=1;\n',
      'public/app.bundle.js': 'var a=1;\n',
    });

    expect(await scan(temp.root_path)).toEqual(['src/app.js']);
  });

  it('honours a root .gitignore', async () => {
    const temp = make_project({
      '.gitignore': 'generated/\n*.gen.ts\n',
      'src/index.ts': 'export {};\n',
      'src/schema.gen.ts': 'export {};\n',
      'generated/client.ts': 'export {};\n',
    });

    expect(await scan(temp.root_path)).toEqual(['src/index.ts']);
  });

  it('honours a nested .gitignore only within its own subtree', async () => {
    const temp = make_project({
      'apps/web/.gitignore': 'secret.ts\n',
      'apps/web/secret.ts': 'export {};\n',
      'apps/web/public.ts': 'export {};\n',
      'apps/api/secret.ts': 'export {};\n',
    });

    expect(await scan(temp.root_path)).toEqual(['apps/api/secret.ts', 'apps/web/public.ts']);
  });

  it('honours gitignore negation patterns', async () => {
    const temp = make_project({
      '.gitignore': 'vendor/*\n!vendor/keep.ts\n',
      'vendor/keep.ts': 'export {};\n',
      'vendor/drop.ts': 'export {};\n',
    });

    expect(await scan(temp.root_path)).toEqual(['vendor/keep.ts']);
  });

  it('can disable gitignore handling', async () => {
    const temp = make_project({
      '.gitignore': 'generated/\n',
      'generated/client.ts': 'export {};\n',
      'src/index.ts': 'export {};\n',
    });

    expect(await scan(temp.root_path, { respect_gitignore: false })).toEqual([
      'generated/client.ts',
      'src/index.ts',
    ]);
  });

  it('accepts custom ignored directories and patterns', async () => {
    const temp = make_project({
      'vendor/lib.ts': 'export {};\n',
      'src/index.ts': 'export {};\n',
      'src/index.spec.ts': 'export {};\n',
    });

    expect(
      await scan(temp.root_path, {
        ignored_directories: ['vendor'],
        ignore_patterns: ['**/*.spec.ts'],
      }),
    ).toEqual(['src/index.ts']);
  });

  it('scans a directory named dist when the defaults are overridden', async () => {
    const temp = make_project({ 'dist/output.ts': 'export {};\n' });

    expect(await scan(temp.root_path, { ignored_directories: [] })).toEqual(['dist/output.ts']);
  });
});

describe('scan_project limits', () => {
  it('skips files over the size limit and reports why', async () => {
    const temp = make_project({
      'src/small.ts': 'export {};\n',
      'src/huge.ts': 'x'.repeat(5000),
    });

    const result = await scan_project({ root_path: temp.root_path, max_file_size_bytes: 1000 });

    expect(result.files.map((file) => file.relative_path)).toEqual(['src/small.ts']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('too_large');
    expect(result.skipped[0]?.relative_path).toBe('src/huge.ts');
    expect(result.skipped[0]?.detail).toContain('5000 bytes');
  });

  it('stops at max_files and says so', async () => {
    const temp = make_project({
      'a.ts': 'export {};\n',
      'b.ts': 'export {};\n',
      'c.ts': 'export {};\n',
    });

    const result = await scan_project({ root_path: temp.root_path, max_files: 2 });

    expect(result.files).toHaveLength(2);
    expect(result.skipped[0]?.reason).toBe('max_files_reached');
  });

  it('stops descending past max_depth', async () => {
    const temp = make_project({
      'a.ts': 'export {};\n',
      'one/two/three/deep.ts': 'export {};\n',
    });

    const result = await scan_project({ root_path: temp.root_path, max_depth: 1 });

    expect(result.files.map((file) => file.relative_path)).toEqual(['a.ts']);
    expect(result.skipped.some((entry) => entry.reason === 'max_depth_exceeded')).toBe(true);
  });
});

const symlink_support = detect_symlink_support();

describe('scan_project symlink handling', () => {
  const it_with_file_links = it.skipIf(!symlink_support.files);
  const it_with_dir_links = it.skipIf(!symlink_support.directories);

  it_with_file_links('skips symlinks by default and reports them', async () => {
    const temp = make_project({ 'src/real.ts': 'export {};\n' });
    temp.create_symlink('src/link.ts', temp.resolve_path('src/real.ts'), 'file');

    const result = await scan_project({ root_path: temp.root_path });

    expect(result.files.map((file) => file.relative_path)).toEqual(['src/real.ts']);
    expect(result.skipped[0]?.reason).toBe('symlink');
  });

  it_with_file_links('reports a symlinked file under its canonical path, once', async () => {
    const temp = make_project({ 'src/real.ts': 'export {};\n' });
    temp.create_symlink('src/link.ts', temp.resolve_path('src/real.ts'), 'file');

    // `link.ts` sorts before `real.ts`, so the link is encountered first. It must
    // still be reported as `src/real.ts` and must not produce a second entry.
    expect(await scan(temp.root_path, { follow_symlinks: true })).toEqual(['src/real.ts']);
  });

  it_with_file_links('reaches a file that is only accessible through a symlink', async () => {
    const temp = make_project({ 'shared/util.ts': 'export {};\n' });
    temp.create_symlink('alias.ts', temp.resolve_path('shared/util.ts'), 'file');

    expect(await scan(temp.root_path, { follow_symlinks: true })).toEqual(['shared/util.ts']);
  });

  it_with_file_links('refuses to follow a file symlink out of the project root', async () => {
    const outside = create_temp_project({ 'secret.ts': 'export const secret = 1;\n' });
    const temp = make_project({ 'src/index.ts': 'export {};\n' });

    try {
      temp.create_symlink('src/escape.ts', outside.resolve_path('secret.ts'), 'file');

      const result = await scan_project({ root_path: temp.root_path, follow_symlinks: true });

      expect(result.files.map((file) => file.relative_path)).toEqual(['src/index.ts']);
      expect(result.skipped[0]?.reason).toBe('outside_root');
    } finally {
      outside.cleanup();
    }
  });

  it_with_dir_links('skips a directory symlink by default', async () => {
    const outside = create_temp_project({ 'lib/secret.ts': 'export const secret = 1;\n' });
    const temp = make_project({ 'src/index.ts': 'export {};\n' });

    try {
      temp.create_symlink('src/escape', outside.resolve_path('lib'), 'dir');

      const result = await scan_project({ root_path: temp.root_path });

      expect(result.files.map((file) => file.relative_path)).toEqual(['src/index.ts']);
      expect(result.skipped[0]?.reason).toBe('symlink');
    } finally {
      outside.cleanup();
    }
  });

  it_with_dir_links('refuses to follow a directory symlink out of the project root', async () => {
    const outside = create_temp_project({ 'lib/secret.ts': 'export const secret = 1;\n' });
    const temp = make_project({ 'src/index.ts': 'export {};\n' });

    try {
      temp.create_symlink('src/escape', outside.resolve_path('lib'), 'dir');

      const result = await scan_project({ root_path: temp.root_path, follow_symlinks: true });

      expect(result.files.map((file) => file.relative_path)).toEqual(['src/index.ts']);
      expect(result.skipped.some((entry) => entry.reason === 'outside_root')).toBe(true);
    } finally {
      outside.cleanup();
    }
  });

  it_with_dir_links('terminates on a symlink cycle without duplicating files', async () => {
    const temp = make_project({ 'src/index.ts': 'export {};\n' });
    temp.create_symlink('src/loop', temp.root_path, 'dir');

    const result = await scan_project({ root_path: temp.root_path, follow_symlinks: true });

    expect(result.files.map((file) => file.relative_path)).toEqual(['src/index.ts']);
  });

  it_with_dir_links('does not walk the same directory twice through two links', async () => {
    const temp = make_project({ 'shared/util.ts': 'export {};\n' });
    temp.create_symlink('link_a', temp.resolve_path('shared'), 'dir');
    temp.create_symlink('link_b', temp.resolve_path('shared'), 'dir');

    const result = await scan_project({ root_path: temp.root_path, follow_symlinks: true });

    // Both links sort before `shared`, yet the canonical path is what is reported.
    expect(result.files.map((file) => file.relative_path)).toEqual(['shared/util.ts']);
  });

  it_with_dir_links('resolves absolute paths of symlinked files to the real location', async () => {
    const temp = make_project({ 'shared/util.ts': 'export {};\n' });
    temp.create_symlink('alias', temp.resolve_path('shared'), 'dir');

    const result = await scan_project({ root_path: temp.root_path, follow_symlinks: true });

    expect(result.files[0]?.file_path).toBe(temp.resolve_path('shared/util.ts'));
  });
});

describe('scan_project failure handling', () => {
  it('rejects a relative root path', async () => {
    await expect(scan_project({ root_path: 'src' })).rejects.toThrowError(code_intelligence_error);
  });

  it('reports an unreadable root instead of throwing', async () => {
    const temp = make_project({});
    const result = await scan_project({ root_path: temp.resolve_path('does-not-exist') });

    expect(result.files).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('unreadable');
  });
});

describe('walk_project', () => {
  it('streams the same files that scan_project collects', async () => {
    const temp = make_project(MONOREPO_FILES);

    const streamed: string[] = [];
    for await (const event of walk_project({ root_path: temp.root_path })) {
      if (event.type === 'file') {
        streamed.push(event.file.relative_path);
      }
    }

    expect(streamed).toEqual(await scan(temp.root_path));
  });

  it('emits a directory event for the root', async () => {
    const temp = make_project({ 'a.ts': 'export {};\n' });

    const directories: string[] = [];
    for await (const event of walk_project({ root_path: temp.root_path })) {
      if (event.type === 'directory') {
        directories.push(event.relative_path);
      }
    }

    expect(directories).toEqual(['.']);
  });

  it('can be abandoned early without scanning the rest', async () => {
    const temp = make_project(MONOREPO_FILES);

    const iterator = walk_project({ root_path: temp.root_path });
    const first_file = await find_first_file(iterator);

    expect(first_file).toBe('apps/api/src/esm.mjs');
  });
});

async function find_first_file(events: AsyncGenerator<{ type: string }>): Promise<string | undefined> {
  for await (const event of events as AsyncGenerator<
    { type: 'file'; file: scanned_file } | { type: string }
  >) {
    if (event.type === 'file') {
      return (event as { file: scanned_file }).file.relative_path;
    }
  }
  return undefined;
}
