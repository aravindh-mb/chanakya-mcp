import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { get_dependencies, get_dependents } from '../../src/graph/graph.js';
import { index_project } from '../../src/indexer/index_project.js';
import {
  find_workspace_packages,
  resolve_workspace_specifier,
} from '../../src/indexer/workspace_packages.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project | undefined;
let store: index_store | undefined;

afterEach(() => {
  store?.close();
  store = undefined;
  project?.cleanup();
  project = undefined;
});

const MONOREPO: Readonly<Record<string, string>> = {
  'package.json': '{ "name": "root", "private": true, "workspaces": ["apps/*", "packages/*"] }',
  'packages/shared/package.json':
    '{ "name": "@acme/shared", "main": "./dist/index.js", "types": "./src/index.ts" }',
  'packages/shared/src/index.ts': "export * from './types.js';\nexport * from './money.js';\n",
  'packages/shared/src/types.ts': 'export interface user { id: string }\nexport type user_id = string;\n',
  'packages/shared/src/money.ts': 'export function format_money(cents: number) { return String(cents); }\n',
  'packages/shared/src/extra/tools.ts': 'export const tool = 1;\n',
  'apps/api/package.json': '{ "name": "@acme/api" }',
  'apps/api/src/users.ts': "import type { user } from '@acme/shared';\nexport const list: user[] = [];\n",
  'apps/api/src/money_only.ts':
    "import { format_money } from '@acme/shared';\nexport const total = format_money(1);\n",
  'apps/api/src/everything.ts': "import * as shared from '@acme/shared';\nexport const all = shared;\n",
  'apps/api/src/sub.ts': "import { tool } from '@acme/shared/extra/tools';\nexport const t = tool;\n",
  'apps/api/src/external.ts':
    "import { readFile } from 'node:fs';\nimport React from 'react';\nexport { readFile, React };\n",
};

async function index(files: Readonly<Record<string, string>>): Promise<index_store> {
  project = create_temp_project(files);
  project.backdate_all(60_000);
  store = index_store.open({
    data_dir_path: join(project.root_path, '.code-intelligence'),
    project_root: project.root_path,
    in_memory: true,
  });
  await index_project({ store, root_path: project.root_path });
  return store;
}

describe('workspace packages', () => {
  it('finds packages by their package.json name', async () => {
    const opened = await index(MONOREPO);
    const packages = find_workspace_packages(project!.root_path, new Set(opened.list_file_paths()));

    expect(packages.get('@acme/shared')?.directory).toBe('packages/shared');
    expect(packages.get('@acme/api')?.directory).toBe('apps/api');
    expect(packages.get('root')?.directory).toBe('');
  });

  it('resolves a package import to its source entry when main points at an unindexed build', async () => {
    const opened = await index(MONOREPO);
    const imports = get_dependencies({ store: opened }, 'apps/api/src/users.ts').dependencies;

    expect(imports.map((item) => item.target)).toEqual(['packages/shared/src/index.ts']);
    expect(imports[0]?.resolved).toBe(true);
  });

  it('resolves a subpath import', async () => {
    const opened = await index(MONOREPO);
    const imports = get_dependencies({ store: opened }, 'apps/api/src/sub.ts').dependencies;

    expect(imports.map((item) => item.target)).toEqual(['packages/shared/src/extra/tools.ts']);
  });

  it('leaves real external packages unresolved', async () => {
    const opened = await index(MONOREPO);
    const imports = get_dependencies({ store: opened }, 'apps/api/src/external.ts').dependencies;

    expect(imports.every((item) => !item.resolved)).toBe(true);
    expect(imports.map((item) => item.target).sort()).toEqual(['node:fs', 'react']);
  });

  it('refuses a name two packages claim', () => {
    const files = new Set(['a/src/index.ts', 'b/src/index.ts']);
    project = create_temp_project({
      'a/package.json': '{ "name": "@acme/dup" }',
      'b/package.json': '{ "name": "@acme/dup" }',
      'a/src/index.ts': 'export const a = 1;\n',
      'b/src/index.ts': 'export const b = 1;\n',
    });
    const packages = find_workspace_packages(project.root_path, files);

    expect(packages.has('@acme/dup')).toBe(false);
    expect(resolve_workspace_specifier('@acme/dup', packages, files)).toBeUndefined();
  });

  it('prefers a declared exports entry', () => {
    const files = new Set(['pkg/lib/entry.ts', 'pkg/src/index.ts']);
    project = create_temp_project({
      'pkg/package.json':
        '{ "name": "@acme/pkg", "exports": { ".": { "types": "./lib/entry.ts", "default": "./dist/x.js" } } }',
      'pkg/lib/entry.ts': 'export const a = 1;\n',
      'pkg/src/index.ts': 'export const b = 1;\n',
    });
    const packages = find_workspace_packages(project.root_path, files);

    expect(resolve_workspace_specifier('@acme/pkg', packages, files)).toBe('pkg/lib/entry.ts');
  });
});

describe('get_dependents through barrels', () => {
  it('lists files that import the target through a package barrel', async () => {
    const opened = await index(MONOREPO);
    const dependents = get_dependents({ store: opened }, 'packages/shared/src/types.ts').dependents;
    const by_path = new Map(dependents.map((item) => [item.file_path, item]));

    expect(by_path.get('packages/shared/src/index.ts')?.kind).toBe('re_export');
    expect(by_path.get('apps/api/src/users.ts')?.via).toBe('packages/shared/src/index.ts');
    expect(by_path.get('apps/api/src/users.ts')?.local_names).toEqual(['user']);
  });

  it('includes a namespace import of the barrel', async () => {
    const opened = await index(MONOREPO);
    const paths = get_dependents({ store: opened }, 'packages/shared/src/types.ts').dependents.map(
      (item) => item.file_path,
    );

    expect(paths).toContain('apps/api/src/everything.ts');
  });

  it('excludes files that take only other modules’ names from the same barrel', async () => {
    const opened = await index(MONOREPO);
    const types_dependents = get_dependents({ store: opened }, 'packages/shared/src/types.ts').dependents.map(
      (item) => item.file_path,
    );
    const money_dependents = get_dependents({ store: opened }, 'packages/shared/src/money.ts').dependents.map(
      (item) => item.file_path,
    );

    expect(types_dependents).not.toContain('apps/api/src/money_only.ts');
    expect(money_dependents).toContain('apps/api/src/money_only.ts');
    expect(money_dependents).not.toContain('apps/api/src/users.ts');
  });

  it('marks direct importers without via', async () => {
    const opened = await index({
      'src/types.ts': 'export interface user { id: string }\n',
      'src/app.ts': "import type { user } from './types';\nexport const u: user[] = [];\n",
    });
    const dependents = get_dependents({ store: opened }, 'src/types.ts').dependents;

    expect(dependents).toEqual([
      { file_path: 'src/app.ts', kind: 'import', local_names: ['user'], specifiers: ['./types'], line: 1 },
    ]);
  });
});
