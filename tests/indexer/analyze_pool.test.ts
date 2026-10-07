import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { create_analyze_pool } from '../../src/indexer/analyze_pool.js';
import { create_temp_project } from '../helpers/temp_project.js';
import type * as package_entry from '../../src/index.js';

const DIST_INDEX = resolve(__dirname, '../../dist/index.js');
const DIST_WORKER = resolve(__dirname, '../../dist/indexer/analyze_worker.js');

describe('create_analyze_pool', () => {
  it('declines to start for fewer than two workers', () => {
    expect(create_analyze_pool({ files: new Set(), size: 1 })).toBeUndefined();
  });

  it('falls back to in-process analysis when no built worker script exists', () => {
    // Running from the TypeScript sources there is no analyze_worker.js next to
    // the pool, so the indexer must analyse in-process rather than fail.
    expect(create_analyze_pool({ files: new Set(), size: 4 })).toBeUndefined();
  });
});

// The worker only exists in the build, so this runs against dist/ when it has
// been built (locally after `pnpm run build`) and is skipped otherwise.
describe.skipIf(!existsSync(DIST_INDEX) || !existsSync(DIST_WORKER))(
  'parallel indexing (built package)',
  () => {
    it('produces the same index as in-process analysis', async () => {
      const dist = (await import(pathToFileURL(DIST_INDEX).href)) as typeof package_entry;

      const files: Record<string, string> = {
        'src/shared.ts': 'export function helper(value: number) { return value + 1; }\n',
      };
      // Enough files to cross the pool's minimum, each calling across files.
      for (let index = 0; index < 120; index += 1) {
        files[`src/module_${index}.ts`] =
          `import { helper } from './shared';\n` +
          `export class service_${index} {\n  run() { return helper(${index}); }\n}\n` +
          (index % 10 === 0 ? 'export const broken = ;\n' : '');
      }
      const project = create_temp_project(files);
      project.backdate_all(60_000);

      const snapshot = async (workers: number): Promise<unknown> => {
        const store = dist.index_store.open({
          data_dir_path: join(project.root_path, `.ci-${workers}`),
          project_root: project.root_path,
          in_memory: true,
        });
        try {
          const result = await dist.index_project({ store, root_path: project.root_path, workers });
          const helper_id = 'src/shared.ts#function:helper';
          return {
            parsed: result.files_parsed,
            failed: result.files_failed,
            syntax_errors: result.files_with_syntax_errors,
            counts: store.count(),
            callers: store
              .get_relationships_to(helper_id)
              .filter((edge) => edge.kind === 'calls')
              .map((edge) => edge.from_id)
              .sort(),
          };
        } finally {
          store.close();
        }
      };

      try {
        const serial = await snapshot(0);
        const parallel = await snapshot(3);
        expect(parallel).toEqual(serial);
        expect((serial as { callers: string[] }).callers).toHaveLength(120);
      } finally {
        project.cleanup();
      }
    });
  },
);
