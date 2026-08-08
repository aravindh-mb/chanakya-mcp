import { describe, expect, it } from 'vitest';
import { hash_content } from '../../src/core/hash.js';
import { create_empty_analysis, type code_file } from '../../src/model/file.js';

const file: code_file = {
  file_path: 'src/user.ts',
  absolute_path: '/project/src/user.ts',
  language: 'typescript',
  size: 42,
  modified_time: 1_700_000_000_000,
  content_hash: hash_content('export const a = 1;'),
  parse_error_count: 0,
};

describe('create_empty_analysis', () => {
  it('returns the file with every collection empty', () => {
    const analysis = create_empty_analysis(file);

    expect(analysis.file).toBe(file);
    expect(analysis.symbols).toEqual([]);
    expect(analysis.relationships).toEqual([]);
    expect(analysis.imports).toEqual([]);
    expect(analysis.exports).toEqual([]);
    expect(analysis.references).toEqual([]);
  });
});

describe('hash_content', () => {
  it('is deterministic', () => {
    expect(hash_content('const a = 1;')).toBe(hash_content('const a = 1;'));
  });

  it('changes when the content changes', () => {
    expect(hash_content('const a = 1;')).not.toBe(hash_content('const a = 2;'));
  });

  it('detects whitespace-only changes', () => {
    // Reformatting changes the source, so the file must be reparsed.
    expect(hash_content('const a = 1;')).not.toBe(hash_content('const a  = 1;'));
  });

  it('is independent of mtime, by construction', () => {
    // A checkout rewrites mtimes without changing content. Hashing content only
    // is what keeps incremental indexing useful after `git checkout`.
    const same_content = 'export function f() {}';

    expect(hash_content(same_content)).toBe(hash_content(same_content));
  });

  it('produces a full sha-256 hex digest', () => {
    expect(hash_content('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles non-ASCII content', () => {
    expect(hash_content('const café = "🎉";')).toMatch(/^[0-9a-f]{64}$/);
    expect(hash_content('const café = "🎉";')).not.toBe(hash_content('const cafe = "🎉";'));
  });

  it('handles empty content', () => {
    expect(hash_content('')).toMatch(/^[0-9a-f]{64}$/);
  });
});
