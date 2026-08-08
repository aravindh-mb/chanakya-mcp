import { describe, expect, it } from 'vitest';
import { detect_changes, normalize_modified_time } from '../../src/indexer/change_detection.js';
import type { file_stamp } from '../../src/store/index_store.js';
import type { scanned_file } from '../../src/scanner/types.js';

function make_scanned(relative_path: string, size = 100, modified_time = 1_000): scanned_file {
  return {
    file_path: `/project/${relative_path}`,
    relative_path,
    extension: '.ts',
    language: 'typescript',
    size,
    modified_time,
  };
}

/**
 * `indexed_at` defaults to well after `modified_time` so stamps represent
 * ordinary settled files. Tests that care about the racy window set it.
 */
function make_stamp(size = 100, modified_time = 1_000, content_hash = 'hash'): file_stamp {
  return { size, modified_time, content_hash, indexed_at: modified_time + 60_000 };
}

describe('detect_changes', () => {
  it('treats everything as added against an empty index', () => {
    const changes = detect_changes({
      stored: new Map(),
      scanned: [make_scanned('a.ts'), make_scanned('b.ts')],
    });

    expect(changes.added.map((file) => file.relative_path)).toEqual(['a.ts', 'b.ts']);
    expect(changes.candidates).toEqual([]);
    expect(changes.unchanged).toEqual([]);
    expect(changes.deleted).toEqual([]);
  });

  it('skips a file whose size and mtime both match', () => {
    const changes = detect_changes({
      stored: new Map([['a.ts', make_stamp(100, 1_000)]]),
      scanned: [make_scanned('a.ts', 100, 1_000)],
    });

    expect(changes.unchanged.map((file) => file.relative_path)).toEqual(['a.ts']);
    expect(changes.candidates).toEqual([]);
  });

  it('flags a file whose size changed', () => {
    const changes = detect_changes({
      stored: new Map([['a.ts', make_stamp(100, 1_000)]]),
      scanned: [make_scanned('a.ts', 250, 1_000)],
    });

    expect(changes.candidates.map((file) => file.relative_path)).toEqual(['a.ts']);
  });

  it('flags a file whose mtime changed', () => {
    const changes = detect_changes({
      stored: new Map([['a.ts', make_stamp(100, 1_000)]]),
      scanned: [make_scanned('a.ts', 100, 2_000)],
    });

    expect(changes.candidates.map((file) => file.relative_path)).toEqual(['a.ts']);
  });

  it('reports files that disappeared from disk', () => {
    const changes = detect_changes({
      stored: new Map([
        ['a.ts', make_stamp()],
        ['gone.ts', make_stamp()],
      ]),
      scanned: [make_scanned('a.ts')],
    });

    expect(changes.deleted).toEqual(['gone.ts']);
  });

  it('reports every deleted file when the project is emptied', () => {
    const changes = detect_changes({
      stored: new Map([
        ['a.ts', make_stamp()],
        ['b.ts', make_stamp()],
      ]),
      scanned: [],
    });

    expect([...changes.deleted].sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('classifies a mixed change set correctly', () => {
    const changes = detect_changes({
      stored: new Map([
        ['same.ts', make_stamp(10, 5)],
        ['edited.ts', make_stamp(10, 5)],
        ['removed.ts', make_stamp(10, 5)],
      ]),
      scanned: [make_scanned('same.ts', 10, 5), make_scanned('edited.ts', 99, 7), make_scanned('new.ts')],
    });

    expect(changes.unchanged.map((file) => file.relative_path)).toEqual(['same.ts']);
    expect(changes.candidates.map((file) => file.relative_path)).toEqual(['edited.ts']);
    expect(changes.added.map((file) => file.relative_path)).toEqual(['new.ts']);
    expect(changes.deleted).toEqual(['removed.ts']);
  });

  it('matches a fractional mtime against the whole number that was stored', () => {
    // `stat` reports fractional milliseconds while the index stores whole ones.
    // Without normalization every file would look modified on every run, which
    // would silently turn incremental indexing back into a full reindex.
    const changes = detect_changes({
      stored: new Map([['a.ts', make_stamp(100, 1_700_000_000_123)]]),
      scanned: [make_scanned('a.ts', 100, 1_700_000_000_123.456)],
    });

    expect(changes.unchanged.map((file) => file.relative_path)).toEqual(['a.ts']);
  });

  it('distrusts a file modified just before it was indexed', () => {
    // Racily clean: filesystem timestamps are coarse, so a file edited in the
    // same tick it was read carries an identical mtime. If the edit also left
    // the size unchanged, nothing in the fingerprint reveals it. Re-hashing a
    // few just-touched files is much cheaper than a silently stale index.
    const changes = detect_changes({
      stored: new Map([['a.ts', { size: 100, modified_time: 5_000, content_hash: 'h', indexed_at: 5_500 }]]),
      scanned: [make_scanned('a.ts', 100, 5_000)],
    });

    expect(changes.candidates.map((file) => file.relative_path)).toEqual(['a.ts']);
    expect(changes.unchanged).toEqual([]);
  });

  it('trusts a file that settled well before it was indexed', () => {
    const changes = detect_changes({
      stored: new Map([['a.ts', { size: 100, modified_time: 5_000, content_hash: 'h', indexed_at: 60_000 }]]),
      scanned: [make_scanned('a.ts', 100, 5_000)],
    });

    expect(changes.unchanged.map((file) => file.relative_path)).toEqual(['a.ts']);
  });

  it('distrusts a file whose mtime is in the future', () => {
    // Clock skew, or a build tool stamping timestamps forward.
    const changes = detect_changes({
      stored: new Map([
        ['a.ts', { size: 100, modified_time: 90_000, content_hash: 'h', indexed_at: 10_000 }],
      ]),
      scanned: [make_scanned('a.ts', 100, 90_000)],
    });

    expect(changes.candidates.map((file) => file.relative_path)).toEqual(['a.ts']);
  });

  it('performs no file reads', () => {
    // Every path here is fictional; the function must not touch the disk.
    expect(() =>
      detect_changes({
        stored: new Map([['nowhere/at/all.ts', make_stamp()]]),
        scanned: [make_scanned('also/fictional.ts')],
      }),
    ).not.toThrow();
  });
});

describe('normalize_modified_time', () => {
  it('rounds to whole milliseconds', () => {
    expect(normalize_modified_time(1_700_000_000_123.456)).toBe(1_700_000_000_123);
    expect(normalize_modified_time(1_700_000_000_123.999)).toBe(1_700_000_000_124);
  });

  it('leaves a whole number alone', () => {
    expect(normalize_modified_time(1_700_000_000_123)).toBe(1_700_000_000_123);
  });
});
