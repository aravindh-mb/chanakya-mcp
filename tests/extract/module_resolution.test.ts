import { describe, expect, it } from 'vitest';
import { build_file_index, resolve_module_specifier } from '../../src/extract/module_resolution.js';

const files = build_file_index(
  [
    'src/app.ts',
    'src/user.ts',
    'src/widget.tsx',
    'src/legacy.js',
    'src/esm.mts',
    'src/common.cts',
    'src/types.d.ts',
    'src/models/index.ts',
    'packages/shared/src/types.ts',
  ].map((relative_path) => ({ relative_path })),
);

function resolve(module_specifier: string, from_file_path = 'src/app.ts') {
  return resolve_module_specifier({ from_file_path, module_specifier, files });
}

describe('resolve_module_specifier: extensionless specifiers', () => {
  it('resolves a bare relative specifier to a .ts file', () => {
    expect(resolve('./user')).toBe('src/user.ts');
  });

  it('resolves to a .tsx file', () => {
    expect(resolve('./widget')).toBe('src/widget.tsx');
  });

  it('resolves a directory to its index file', () => {
    expect(resolve('./models')).toBe('src/models/index.ts');
  });

  it('resolves a parent-directory specifier', () => {
    expect(resolve('../packages/shared/src/types', 'src/app.ts')).toBe('packages/shared/src/types.ts');
  });
});

describe('resolve_module_specifier: NodeNext extension substitution', () => {
  it('resolves ./user.js to user.ts', () => {
    // Under `"module": "NodeNext"` TypeScript requires the specifier to name
    // the *output* file, so this is how modern TS ESM projects are written —
    // including this one. Before this was handled, no relative import in such
    // a project resolved and every cross-file relationship vanished.
    expect(resolve('./user.js')).toBe('src/user.ts');
  });

  it('resolves ./widget.js to widget.tsx', () => {
    expect(resolve('./widget.js')).toBe('src/widget.tsx');
  });

  it('resolves .mjs to .mts', () => {
    expect(resolve('./esm.mjs')).toBe('src/esm.mts');
  });

  it('resolves .cjs to .cts', () => {
    expect(resolve('./common.cjs')).toBe('src/common.cts');
  });

  it('resolves a deep relative specifier written with .js', () => {
    expect(resolve('../repositories/user.js', 'src/services/user.service.ts')).toBeUndefined();
    expect(resolve('../packages/shared/src/types.js', 'src/app.ts')).toBe('packages/shared/src/types.ts');
  });

  it('prefers a real .js file over substituting to .ts', () => {
    // `src/legacy.js` exists, so the exact match must win rather than the
    // substitution silently redirecting to a different file.
    expect(resolve('./legacy.js')).toBe('src/legacy.js');
  });

  it('falls back to a declaration file when only that exists', () => {
    expect(resolve('./types.js')).toBe('src/types.d.ts');
  });

  it('returns undefined when neither the written nor the source file exists', () => {
    expect(resolve('./missing.js')).toBeUndefined();
  });
});

describe('resolve_module_specifier: what it refuses to resolve', () => {
  it('returns undefined for a bare package specifier', () => {
    expect(resolve('react')).toBeUndefined();
    expect(resolve('@scope/pkg')).toBeUndefined();
  });

  it('returns undefined for a workspace alias', () => {
    // Resolving `@sample/shared` needs workspace or tsconfig-paths lookup,
    // which this resolver deliberately does not attempt. Reporting it as
    // unresolved is the honest answer, not a guess.
    expect(resolve('@sample/shared')).toBeUndefined();
  });

  it('returns undefined for a node: builtin', () => {
    expect(resolve('node:fs')).toBeUndefined();
  });

  it('returns undefined for a relative path outside the index', () => {
    expect(resolve('./not-indexed')).toBeUndefined();
  });
});
