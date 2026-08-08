import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { index_project } from '../../src/indexer/index_project.js';
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
function internal_helper() {}
`,
  'src/types/user.ts': `
export interface user { id: string }
export type user_id = string;
export const USER_ROLE = 'admin';
`,
  'src/components/UserCard.tsx': 'export const UserCard = () => <div />;\n',
  'types/legacy.d.ts': 'export declare function legacy_api(): void;\n',
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

function names(options: search_symbols_options): string[] {
  return search_symbols(store, options).hits.map((hit) => hit.symbol.name);
}

describe('search_symbols matching', () => {
  it('finds an exact name', () => {
    expect(names({ query: 'create_user', match: 'exact' })).toEqual(['create_user']);
  });

  it('finds by prefix', () => {
    expect(names({ query: 'create_', match: 'prefix' }).sort()).toEqual(['create_order', 'create_user']);
  });

  it('finds by substring', () => {
    expect(names({ query: '_user' }).sort()).toEqual(['create_user', 'delete_user']);
  });

  it('includes exact and prefix hits when searching by substring', () => {
    // A wider mode subsumes the narrower ones rather than excluding them.
    expect(names({ query: 'user_service' })).toContain('user_service');
  });

  it('returns nothing for a name that does not exist', () => {
    expect(names({ query: 'definitely_not_here' })).toEqual([]);
  });

  it('is case insensitive by default', () => {
    expect(names({ query: 'usercard' })).toContain('UserCard');
  });

  it('respects case when asked', () => {
    expect(names({ query: 'usercard', case_sensitive: true })).toEqual([]);
    expect(names({ query: 'UserCard', case_sensitive: true })).toContain('UserCard');
  });

  it('matches a case-sensitive prefix', () => {
    expect(names({ query: 'User', match: 'prefix', case_sensitive: true })).toEqual(['UserCard']);
  });

  it('treats SQL wildcards as literal characters', () => {
    // Without escaping, `%` would match everything and quietly return the
    // entire index instead of nothing.
    expect(names({ query: '%' })).toEqual([]);
    expect(names({ query: '_' }).length).toBeGreaterThan(0); // real names contain underscores
    expect(names({ query: 'create%user' })).toEqual([]);
  });
});

describe('search_symbols ranking', () => {
  it('puts an exact match before a substring match', () => {
    const hits = search_symbols(store, { query: 'user' }).hits;

    expect(hits[0]?.symbol.name).toBe('user');
    expect(hits[0]?.match).toBe('exact');
  });

  it('reports how each hit matched', () => {
    const hits = search_symbols(store, { query: 'user' }).hits;
    const kinds = new Set(hits.map((hit) => hit.match));

    expect(kinds.has('exact')).toBe(true);
    expect(hits.every((hit) => ['exact', 'prefix', 'substring'].includes(hit.match))).toBe(true);
  });

  it('prefers shorter names among equal match kinds', () => {
    const hits = search_symbols(store, { query: 'user_', match: 'prefix' }).hits;
    const lengths = hits.map((hit) => hit.symbol.name.length);

    expect([...lengths]).toEqual([...lengths].sort((a, b) => a - b));
  });

  it('is deterministic across runs', () => {
    expect(names({ query: 'user' })).toEqual(names({ query: 'user' }));
  });
});

describe('search_symbols filters', () => {
  it('filters by kind', () => {
    expect(names({ query: 'user', kinds: ['interface'] })).toEqual(['user']);
  });

  it('filters by several kinds', () => {
    const found = names({ query: 'user', kinds: ['interface', 'type'] });

    expect(found).toContain('user');
    expect(found).toContain('user_id');
  });

  it('filters by path', () => {
    const found = names({ query: 'user', path_contains: 'src/services' });

    expect(found).toContain('user_service');
    expect(found).not.toContain('user_id');
  });

  it('filters by language', () => {
    expect(names({ query: 'UserCard', languages: ['tsx'] })).toEqual(['UserCard']);
    expect(names({ query: 'UserCard', languages: ['typescript'] })).toEqual([]);
  });

  it('filters to exported symbols only', () => {
    expect(names({ query: 'internal_helper' })).toEqual(['internal_helper']);
    expect(names({ query: 'internal_helper', exported_only: true })).toEqual([]);
  });

  it('can exclude ambient declarations', () => {
    expect(names({ query: 'legacy_api' })).toEqual(['legacy_api']);
    expect(names({ query: 'legacy_api', exclude_ambient: true })).toEqual([]);
  });

  it('combines filters', () => {
    const found = names({ query: 'create', kinds: ['method'], path_contains: 'order' });

    expect(found).toEqual(['create_order']);
  });
});

describe('search_symbols limits', () => {
  it('caps the number of results', () => {
    expect(names({ query: 'e', limit: 2 })).toHaveLength(2);
  });

  it('reports truncation', () => {
    expect(search_symbols(store, { query: 'e', limit: 2 }).truncated).toBe(true);
  });

  it('does not report truncation when everything fits', () => {
    expect(search_symbols(store, { query: 'create_user', match: 'exact' }).truncated).toBe(false);
  });

  it('returns nothing for a zero limit', () => {
    expect(names({ query: 'user', limit: 0 })).toEqual([]);
  });

  it('never returns the same symbol twice across match modes', () => {
    const hits = search_symbols(store, { query: 'user', limit: 100 }).hits;
    const ids = hits.map((hit) => hit.symbol.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('search_symbols results', () => {
  it('carries the location and signature but no source', () => {
    const hit = search_symbols(store, { query: 'create_user', match: 'exact' }).hits[0];

    expect(hit?.symbol.file_path).toBe('src/services/user.service.ts');
    expect(hit?.symbol.start_line).toBeGreaterThan(0);
    expect(hit?.symbol.signature).toContain('create_user');
    expect(Object.keys(hit?.symbol ?? {})).not.toContain('source');
  });

  it('carries the containment parent', () => {
    const hit = search_symbols(store, { query: 'create_user', match: 'exact' }).hits[0];

    expect(hit?.symbol.parent_id).toContain('user_service');
  });
});
