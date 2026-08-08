import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { code_intelligence_error } from '../../src/core/errors.js';
import { index_project } from '../../src/indexer/index_project.js';
import { search_code } from '../../src/search/search_code.js';
import { MAX_LINE_LENGTH, MAX_PATTERN_LENGTH } from '../../src/search/pattern.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project;
let store: index_store;

const FILES: Readonly<Record<string, string>> = {
  'src/user.service.ts': `export class user_service {
  create_user(name: string) {
    return this.db.insert(name);
  }

  delete_user(id: string) {
    return this.db.remove(id);
  }
}
`,
  'src/order.service.ts': `export function place_order() {
  const total = 0;
  return total;
}
`,
  'src/app.tsx': 'export const App = () => <div>hello</div>;\n',
  'README.md': 'this file is not indexed and must never be searched\n',
};

beforeEach(async () => {
  project = create_temp_project(FILES);
  project.backdate_all(60_000);
  store = index_store.open({
    data_dir_path: join(project.root_path, '.code-intelligence'),
    project_root: project.root_path,
    in_memory: true,
  });
  await index_project({ store, root_path: project.root_path });
});

afterEach(() => {
  store.close();
  project.cleanup();
});

describe('search_code literal search', () => {
  it('finds a literal string', async () => {
    const result = await search_code(store, { query: 'this.db.insert' });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.file_path).toBe('src/user.service.ts');
    expect(result.matches[0]?.line).toBe(3);
  });

  it('reports a 1-based column', async () => {
    const result = await search_code(store, { query: 'class' });

    expect(result.matches[0]?.column).toBe(8);
  });

  it('returns the matching line trimmed, not the file', async () => {
    const result = await search_code(store, { query: 'this.db.insert' });

    expect(result.matches[0]?.text).toBe('return this.db.insert(name);');
  });

  it('is case insensitive by default', async () => {
    const result = await search_code(store, { query: 'CREATE_USER' });

    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('respects case when asked', async () => {
    expect((await search_code(store, { query: 'CREATE_USER', case_sensitive: true })).matches).toEqual([]);
    expect(
      (await search_code(store, { query: 'create_user', case_sensitive: true })).matches.length,
    ).toBeGreaterThan(0);
  });

  it('treats regex metacharacters as literal text', async () => {
    // Without escaping, `.` would match any character and this would find
    // matches that are not there.
    const result = await search_code(store, { query: 'this.db' });

    expect(result.matches.every((match) => match.text.includes('this.db'))).toBe(true);
  });

  it('never searches files the index excludes', async () => {
    const result = await search_code(store, { query: 'never be searched' });

    expect(result.matches).toEqual([]);
  });
});

describe('search_code regex search', () => {
  it('finds a regular expression', async () => {
    const result = await search_code(store, { query: 'create_\\w+', is_regex: true });

    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('anchors work as expected', async () => {
    const result = await search_code(store, { query: '^export class', is_regex: true });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.file_path).toBe('src/user.service.ts');
  });

  it('does not carry regex state between lines', async () => {
    // A `g`-flagged regex reused across lines keeps `lastIndex` and silently
    // skips matches, which is why the matcher avoids the flag entirely.
    const result = await search_code(store, { query: 'return', is_regex: true, limit: 100 });

    expect(result.matches.length).toBe(3);
  });

  it('rejects an invalid pattern with a useful message', async () => {
    await expect(search_code(store, { query: '(unclosed', is_regex: true })).rejects.toThrowError(
      /not a valid regular expression/,
    );
  });

  it('rejects an over-long pattern', async () => {
    await expect(
      search_code(store, { query: 'a'.repeat(MAX_PATTERN_LENGTH + 1), is_regex: true }),
    ).rejects.toThrowError(code_intelligence_error);
  });

  it('rejects an empty query', async () => {
    await expect(search_code(store, { query: '' })).rejects.toThrowError(/query is empty/);
  });

  it('refuses a catastrophically backtracking pattern instead of running it', async () => {
    // Measured: `(a+)+$` needs 15 seconds against a 30 character line, and the
    // engine never yields, so it must be rejected before it starts.
    const started_at = Date.now();

    await expect(search_code(store, { query: '(a+)+$', is_regex: true })).rejects.toThrowError(
      /exponential time/,
    );

    expect(Date.now() - started_at).toBeLessThan(1_000);
  });

  it('still allows ordinary patterns containing quantifiers', async () => {
    const result = await search_code(store, { query: 'create_\\w+', is_regex: true });

    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('skips lines long enough to make backtracking dangerous', async () => {
    project.write_file('src/generated.ts', `const blob = "${'x'.repeat(MAX_LINE_LENGTH + 100)}";\n`);
    await index_project({ store, root_path: project.root_path });

    const result = await search_code(store, { query: 'x+x+$', is_regex: true, time_budget_ms: 2_000 });

    expect(result.matches.every((match) => match.file_path !== 'src/generated.ts')).toBe(true);
  });

  it('terminates a pathological pattern the static check misses', async () => {
    // `(a|a)+$` defeats the nested-quantifier heuristic, and against a failing
    // line it backtracks exponentially — measured: a 500 character line has not
    // answered after minutes. Matching runs in a worker thread, so the time
    // budget terminates it instead of hanging the server.
    project.write_file('src/pathological.ts', `const blob = "${'a'.repeat(400)}b";\n`);
    await index_project({ store, root_path: project.root_path });
    const started_at = Date.now();

    const result = await search_code(store, {
      query: '(a|a)+$',
      is_regex: true,
      time_budget_ms: 500,
    });

    expect(result.timed_out).toBe(true);
    expect(Date.now() - started_at).toBeLessThan(10_000);
  });

  it('searches normally again after a timed-out search', async () => {
    project.write_file('src/pathological.ts', `const blob = "${'a'.repeat(400)}b";\n`);
    await index_project({ store, root_path: project.root_path });

    await search_code(store, { query: '(a|a)+$', is_regex: true, time_budget_ms: 500 });

    const result = await search_code(store, { query: '^export class', is_regex: true });

    expect(result.timed_out).toBe(false);
    expect(result.matches).toHaveLength(1);
  });
});

describe('search_code enclosing symbol', () => {
  it('reports which symbol contains the match', async () => {
    const result = await search_code(store, { query: 'this.db.insert' });

    expect(result.matches[0]?.enclosing?.name).toBe('create_user');
    expect(result.matches[0]?.enclosing?.kind).toBe('method');
  });

  it('picks the innermost symbol, not the outermost', async () => {
    // Knowing a match is in `create_user` is far more useful than knowing it is
    // somewhere in `user_service`.
    const result = await search_code(store, { query: 'this.db.remove' });

    expect(result.matches[0]?.enclosing?.name).toBe('delete_user');
  });

  it('omits the enclosing symbol when the match is outside any', async () => {
    project.write_file('src/bare.ts', '// a comment at the top\nexport const x = 1;\n');
    await index_project({ store, root_path: project.root_path });

    const result = await search_code(store, { query: 'a comment at the top' });

    expect(result.matches[0]?.enclosing).toBeUndefined();
  });
});

describe('search_code filters and limits', () => {
  it('filters by path', async () => {
    const result = await search_code(store, { query: 'return', path_contains: 'order' });

    expect(result.matches.every((match) => match.file_path.includes('order'))).toBe(true);
  });

  it('filters by language', async () => {
    const result = await search_code(store, { query: 'export', languages: ['tsx'] });

    expect(result.matches.map((match) => match.file_path)).toEqual(['src/app.tsx']);
  });

  it('caps total matches and reports truncation', async () => {
    const result = await search_code(store, { query: 'e', limit: 2 });

    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('caps matches per file so one file cannot fill the results', async () => {
    const result = await search_code(store, { query: 'e', max_matches_per_file: 1, limit: 50 });
    const per_file = new Map<string, number>();
    for (const match of result.matches) {
      per_file.set(match.file_path, (per_file.get(match.file_path) ?? 0) + 1);
    }

    expect([...per_file.values()].every((count) => count === 1)).toBe(true);
  });

  it('includes context lines when asked', async () => {
    const result = await search_code(store, { query: 'this.db.insert', context_lines: 1 });

    expect(result.matches[0]?.context_before).toEqual(['create_user(name: string) {']);
    expect(result.matches[0]?.context_after).toEqual(['}']);
  });

  it('omits context by default', async () => {
    const result = await search_code(store, { query: 'this.db.insert' });

    expect(result.matches[0]?.context_before).toBeUndefined();
  });

  it('reports how many files were searched', async () => {
    const result = await search_code(store, { query: 'export' });

    expect(result.files_searched).toBe(3);
  });

  it('reports no timeout on a normal search', async () => {
    expect((await search_code(store, { query: 'export' })).timed_out).toBe(false);
  });

  it('returns nothing for a query that matches nothing', async () => {
    const result = await search_code(store, { query: 'zzz_not_present_anywhere' });

    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('skips a file deleted since indexing rather than failing', async () => {
    project.remove('src/order.service.ts');

    const result = await search_code(store, { query: 'export' });

    expect(result.matches.every((match) => match.file_path !== 'src/order.service.ts')).toBe(true);
    expect(result.files_searched).toBe(2);
  });
});
