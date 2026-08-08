import { describe, expect, it } from 'vitest';
import {
  detect_language,
  get_extension,
  is_supported_file,
  SUPPORTED_EXTENSIONS,
} from '../../src/scanner/language.js';

describe('detect_language', () => {
  it.each([
    ['src/index.js', 'javascript'],
    ['src/index.mjs', 'javascript'],
    ['src/index.cjs', 'javascript'],
    ['src/App.jsx', 'jsx'],
    ['src/index.ts', 'typescript'],
    ['src/index.mts', 'typescript'],
    ['src/index.cts', 'typescript'],
    ['src/types.d.ts', 'typescript'],
    ['src/App.tsx', 'tsx'],
  ] as const)('maps %s to %s', (file_path, expected) => {
    expect(detect_language(file_path)).toBe(expected);
  });

  it('is case insensitive on the extension', () => {
    expect(detect_language('src/Index.TS')).toBe('typescript');
    expect(detect_language('src/App.TSX')).toBe('tsx');
  });

  it.each([
    'README.md',
    'package.json',
    'styles.css',
    'script.py',
    'Makefile',
    'archive.ts.bak',
    'noextension',
  ])('returns undefined for %s', (file_path) => {
    expect(detect_language(file_path)).toBeUndefined();
  });

  it('does not guess that a .js file contains JSX', () => {
    // Detection is by extension only. tree-sitter's javascript grammar parses
    // JSX anyway, so nothing is lost by declining to sniff.
    expect(detect_language('component.js')).toBe('javascript');
  });
});

describe('is_supported_file', () => {
  it('agrees with detect_language', () => {
    expect(is_supported_file('a.ts')).toBe(true);
    expect(is_supported_file('a.md')).toBe(false);
  });

  it('accepts every advertised extension', () => {
    for (const extension of SUPPORTED_EXTENSIONS) {
      expect(is_supported_file(`file${extension}`)).toBe(true);
    }
  });
});

describe('get_extension', () => {
  it('lowercases and keeps the dot', () => {
    expect(get_extension('src/App.TSX')).toBe('.tsx');
  });

  it('returns an empty string when there is no extension', () => {
    expect(get_extension('Makefile')).toBe('');
  });
});
