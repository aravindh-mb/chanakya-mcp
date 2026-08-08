import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extract_file } from '../../src/extract/extract_file.js';
import { get_dependencies, get_dependents } from '../../src/graph/graph.js';
import { resolve_project_graph } from '../../src/indexer/resolve_project_graph.js';
import { parse_source } from '../../src/parser/parse_file.js';
import type { file_analysis } from '../../src/model/file.js';
import { index_store } from '../../src/store/index_store.js';

let store: index_store;

beforeEach(() => {
  store = index_store.open({ data_dir_path: '', project_root: '/project', in_memory: true });
});

afterEach(() => {
  store.close();
});

function analysis_for(relative_path: string, source: string): file_analysis {
  const parsed = parse_source({ source, file_path: relative_path });
  const extracted = extract_file({ parsed, relative_path });
  return {
    file: {
      file_path: relative_path,
      absolute_path: `/project/${relative_path}`,
      language: parsed.language,
      size: source.length,
      modified_time: 0,
      content_hash: `hash-${relative_path}`,
      parse_error_count: 0,
    },
    symbols: extracted.symbols,
    relationships: extracted.relationships,
    imports: extracted.imports,
    exports: extracted.exports,
    references: extracted.references,
  };
}

const USER = `export class user_service {
  create_user() {}
}
export function helper() {}
`;

const APP = `import { user_service } from './user';
import React from 'react';
import { helper } from './user';
import './style.css';

user_service.create_user();
`;

const BARREL = `export * from './user';
`;

function index(...analyses: Array<[string, string]>): void {
  store.transaction(() => {
    for (const [path, source] of analyses) {
      store.write_file_analysis(analysis_for(path, source));
    }
  });
  resolve_project_graph({ store });
}

describe('get_dependencies', () => {
  it('groups imports of the same module into one dependency', () => {
    index(['src/user.ts', USER], ['src/app.ts', APP]);
    const result = get_dependencies({ store }, 'src/app.ts');

    expect(result.dependencies).toEqual([
      {
        target: './style.css',
        is_internal: true,
        resolved: false,
        local_names: [],
        specifiers: ['./style.css'],
        line: 4,
      },
      {
        target: 'react',
        is_internal: false,
        resolved: false,
        local_names: ['React'],
        specifiers: ['react'],
        line: 2,
      },
      {
        target: 'src/user.ts',
        is_internal: true,
        resolved: true,
        local_names: ['user_service', 'helper'],
        specifiers: ['./user'],
        line: 1,
      },
    ]);
  });

  it('returns no dependencies for a file that imports nothing', () => {
    index(['src/user.ts', USER]);
    expect(get_dependencies({ store }, 'src/user.ts').dependencies).toEqual([]);
  });

  it('reports an unknown file as having no dependencies', () => {
    index(['src/user.ts', USER]);
    expect(get_dependencies({ store }, 'src/missing.ts').dependencies).toEqual([]);
  });
});

describe('get_dependents', () => {
  it('finds the files that import a module and the re-exporting barrel', () => {
    index(['src/user.ts', USER], ['src/app.ts', APP], ['src/index.ts', BARREL]);
    const result = get_dependents({ store }, 'src/user.ts');

    expect(result.dependents).toEqual([
      {
        file_path: 'src/app.ts',
        kind: 'import',
        local_names: ['user_service', 'helper'],
        specifiers: ['./user'],
        line: 1,
      },
      {
        file_path: 'src/index.ts',
        kind: 're_export',
        local_names: [],
        specifiers: ['./user'],
        line: 1,
      },
    ]);
  });

  it('returns no dependents for a module nothing pulls in', () => {
    index(['src/user.ts', USER], ['src/app.ts', APP]);
    const result = get_dependents({ store }, 'src/user.ts');

    expect(result.dependents).toEqual([
      {
        file_path: 'src/app.ts',
        kind: 'import',
        local_names: ['user_service', 'helper'],
        specifiers: ['./user'],
        line: 1,
      },
    ]);
    expect(get_dependents({ store }, 'src/standalone.ts').dependents).toEqual([]);
  });

  it('does not count a package import as a dependent file', () => {
    index(['src/app.ts', "import React from 'react';\n"]);
    expect(get_dependents({ store }, 'react').dependents).toEqual([]);
  });
});
