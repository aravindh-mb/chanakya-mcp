/**
 * Regression tests for the search layer's injection defences.
 *
 * Every query value is bound as a SQL parameter, and anything used inside a
 * `LIKE` pattern is escaped (`%`, `_`, `\`), so input that looks like SQL or
 * LIKE syntax must be treated as the literal text the user asked for. The tests
 * here are phrased as "zero hits means the input stayed literal": if a `%`
 * query returned every symbol, or a `' OR 1=1 --` query returned the world,
 * the layer would have broken its one promise.
 */

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { index_project } from '../../src/indexer/index_project.js';
import { search_code } from '../../src/search/search_code.js';
import { search_symbols } from '../../src/search/search_symbols.js';
import type { search_symbols_options } from '../../src/search/types.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project;
let store: index_store;

const FILES: Readonly<Record<string, string>> = {
  'src/services/user.service.ts': `
export class user_service {
  create_user() {}
  delete_user() {}
}
  `,
  'src/services/order.service.ts': `
export class order_service {
  create_order() {}
}
  `,
  'src/components/UserCard.tsx': 'export const UserCard = () => <div />;\n',
  'src/regex-utils.ts': `
export const ANY = '.*';
export const DIGIT = '\\\\d';
export const PAREN = '(';
  `,
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

function symbol_names(options: search_symbols_options): string[] {
  return search_symbols(store, options).hits.map((hit) => hit.symbol.name);
}

describe('search_symbols SQL parameterization', () => {
  it('treats a query that looks like a SQL clause as literal text', () => {
    expect(() => symbol_names({ query: "' OR 1=1 --" })).not.toThrow();
    expect(symbol_names({ query: "' OR 1=1 --" })).toEqual([]);
  });

  it('treats an unterminated quote as literal text', () => {
    expect(() => symbol_names({ query: "don't" })).not.toThrow();
    expect(symbol_names({ query: "don't" })).toEqual([]);
  });

  it('still finds plain queries, so the escaping did not break normal use', () => {
    expect(symbol_names({ query: 'create' })).toContain('create_user');
    expect(symbol_names({ query: 'create' })).toContain('create_order');
  });
});

describe('search_symbols LIKE wildcard escaping', () => {
  it('a % query matches no symbol, instead of every symbol', () => {
    // Unescaped, `%` in a LIKE pattern matches the whole table.
    expect(symbol_names({ query: '%' })).toEqual([]);
  });

  it('a _ query matches only names containing a literal underscore', () => {
    const hits = symbol_names({ query: '_' });
    expect(hits.length).toBeGreaterThan(0);
    // UserCard has no underscore; an unescaped `_` wildcard would match it.
    expect(hits).not.toContain('UserCard');
  });

  it('escapes path_contains so a % query finds no files, not all files', () => {
    const hits = search_symbols(store, { query: 'user', path_contains: '%' }).hits;
    expect(hits).toEqual([]);
  });

  it('path_contains still matches a plain substring', () => {
    const hits = search_symbols(store, { query: 'UserCard', path_contains: 'components' }).hits;
    expect(hits.map((hit) => hit.symbol.name)).toEqual(['UserCard']);
  });
});

describe('search_code literal mode', () => {
  it('matches .* as the literal characters, not as a regex that matches everything', async () => {
    const result = await search_code(store, { query: '.*' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.file_path).toBe('src/regex-utils.ts');
    expect(result.matches[0]?.text).toContain('ANY');
  });

  it('matches \\d as the literal backslash-d', async () => {
    const result = await search_code(store, { query: '\\d' });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.text).toContain('DIGIT');
  });

  it('does not reject an unbalanced parenthesis in literal mode', async () => {
    await expect(search_code(store, { query: '(' })).resolves.toBeTruthy();
    const result = await search_code(store, { query: '(' });
    expect(result.matches.some((match) => match.text.includes('PAREN'))).toBe(true);
  });

  it('escapes path_contains so a % query searches no files instead of all files', async () => {
    const result = await search_code(store, { query: 'user', path_contains: '%' });
    expect(result.matches).toEqual([]);
    expect(result.files_searched).toBe(0);
  });
});

describe('search_code regex mode', () => {
  it('rejects an invalid pattern with a clear error instead of a crash', async () => {
    await expect(search_code(store, { query: '(', is_regex: true })).rejects.toMatchObject({
      code: 'invalid_usage',
    });
  });
});
