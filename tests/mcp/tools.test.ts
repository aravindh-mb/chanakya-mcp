import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { index_project } from '../../src/indexer/index_project.js';
import { list_tools } from '../../src/mcp/tools.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project;
let store: index_store;

const FILES: Readonly<Record<string, string>> = {
  'src/user.ts': `export class user_service {
  create_user() {}
}
export function helper() {}
`,
  'src/app.ts': `import { user_service } from './user';
import { helper } from './user';

export function run() {
  user_service.create_user();
  helper();
}
`,
  'src/index.ts': `export * from './user';
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

const tools = new Map(list_tools().map((tool) => [tool.name, tool]));

async function call(name: string, args: unknown): Promise<unknown> {
  const tool = tools.get(name);
  if (tool === undefined) {
    throw new Error(`unknown tool ${name}`);
  }
  return tool.call(
    {
      store,
      root_path: project.root_path,
      reindex: async () => await index_project({ store, root_path: project.root_path }),
    },
    args,
  );
}

describe('mcp tools', () => {
  it('search_symbols finds a symbol by name', async () => {
    const result = (await call('search_symbols', { query: 'user_service' })) as {
      symbols: Array<{ name: string; kind: string; id: string }>;
    };

    expect(result.symbols[0]!.name).toBe('user_service');
    expect(result.symbols[0]!.kind).toBe('class');
  });

  it('search_code finds a match annotated with its enclosing symbol', async () => {
    const result = (await call('search_code', { query: 'create_user' })) as {
      matches: Array<{ symbol_name?: string; line: number }>;
    };

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]!.line).toBeGreaterThanOrEqual(1);
  });

  it('get_symbol returns the full row and rejects an unknown id', async () => {
    const found = (await call('search_symbols', { query: 'helper' })) as {
      symbols: Array<{ id: string }>;
    };
    const id = found.symbols[0]!.id;

    const result = (await call('get_symbol', { id })) as { symbol: { name: string; kind: string } };

    expect(result.symbol.name).toBe('helper');
    expect(result.symbol.kind).toBe('function');
    await expect(call('get_symbol', { id: 'src/user.ts#function:missing' })).rejects.toThrow(
      "no symbol with id 'src/user.ts#function:missing'",
    );
  });

  it('get_file_structure nests members under their parents', async () => {
    const result = (await call('get_file_structure', { path: 'src/user.ts' })) as {
      file: { file_path: string } | undefined;
      symbols: Array<{ name: string; kind: string; children: Array<{ name: string }> }>;
    };

    expect(result.file?.file_path).toBe('src/user.ts');
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(['user_service', 'helper']);
    expect(result.symbols[0]!.kind).toBe('class');
    expect(result.symbols[0]!.children[0]!.name).toBe('create_user');
  });

  it('find_definition locates the declaration of a symbol', async () => {
    const found = (await call('search_symbols', { query: 'create_user' })) as {
      symbols: Array<{ id: string }>;
    };
    const result = (await call('find_definition', { id: found.symbols[0]!.id })) as {
      symbol: { name: string; file_path: string };
    };

    expect(result.symbol.name).toBe('create_user');
    expect(result.symbol.file_path).toBe('src/user.ts');
  });

  it('find_references lists the definition before the uses', async () => {
    const found = (await call('search_symbols', { query: 'user_service' })) as {
      symbols: Array<{ id: string }>;
    };
    const result = (await call('find_references', { id: found.symbols[0]!.id })) as {
      references: Array<{ is_definition: boolean; file_path: string }>;
    };

    expect(result.references[0]!.is_definition).toBe(true);
    expect(
      result.references.filter((reference) => reference.file_path === 'src/app.ts').length,
    ).toBeGreaterThan(0);
  });

  it('get_callers reports which symbol calls the target', async () => {
    const found = (await call('search_symbols', { query: 'create_user' })) as {
      symbols: Array<{ id: string }>;
    };
    const result = (await call('get_callers', { id: found.symbols[0]!.id })) as {
      callers: Array<{ symbol_id: string }>;
    };

    expect(result.callers.length).toBeGreaterThan(0);
  });

  it('get_callees lists the symbols the target calls', async () => {
    const found = (await call('search_symbols', { query: 'run' })) as {
      symbols: Array<{ id: string }>;
    };
    const result = (await call('get_callees', { id: found.symbols[0]!.id })) as {
      callees: Array<{ callee?: { name: string } | undefined; callee_name: string }>;
    };

    expect(result.callees.map((callee) => callee.callee?.name ?? callee.callee_name)).toContain(
      'create_user',
    );
  });

  it('get_dependencies groups imports of the same module', async () => {
    const result = (await call('get_dependencies', { path: 'src/app.ts' })) as {
      dependencies: Array<{ target: string; resolved: boolean }>;
    };

    const user = result.dependencies.find((dependency) => dependency.target === 'src/user.ts');
    expect(user).toBeDefined();
    expect(user?.resolved).toBe(true);
  });

  it('get_dependents lists importers and barrels', async () => {
    const result = (await call('get_dependents', { path: 'src/user.ts' })) as {
      dependents: Array<{ file_path: string; kind: string }>;
    };

    expect(result.dependents.map((dependent) => dependent.file_path)).toContain('src/app.ts');
    expect(result.dependents.map((dependent) => dependent.file_path)).toContain('src/index.ts');
  });

  it('get_symbol_context bundles the symbol into one result', async () => {
    const found = (await call('search_symbols', { query: 'user_service' })) as {
      symbols: Array<{ id: string }>;
    };
    const result = (await call('get_symbol_context', { id: found.symbols[0]!.id })) as {
      symbol: { name: string; kind: string; signature: string };
      callers: { total: number };
      references: { total: number };
    };

    expect(result.symbol.name).toBe('user_service');
    expect(result.symbol.kind).toBe('class');
    expect(result.symbol.signature).toBe('class user_service');
    expect(result.references.total).toBe(2);
    expect(result.callers.total).toBe(0);
  });

  it('get_symbol_context reports a tool error for a missing id', async () => {
    await expect(call('get_symbol_context', { id: 'missing-id' })).rejects.toThrow(
      /no symbol with id/,
    );
  });
});
