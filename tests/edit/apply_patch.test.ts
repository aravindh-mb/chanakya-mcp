import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply_patch } from '../../src/edit/apply_patch.js';
import { resolve_project_path } from '../../src/edit/project_file.js';
import { index_project } from '../../src/indexer/index_project.js';
import type { index_project_result } from '../../src/indexer/index_project.js';
import { index_store } from '../../src/store/index_store.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project;
let store: index_store;

const FILES: Readonly<Record<string, string>> = {
  'src/greeter.ts': `export function greet(name: string): string {
  return \`hello \${name}\`;
}
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

const reindex = (): Promise<index_project_result> => index_project({ store, root_path: project.root_path });

function on_disk(relative_path: string): string {
  return readFileSync(project.resolve_path(relative_path), 'utf8');
}

describe('apply_patch', () => {
  it('applies edits in order against the evolving content', async () => {
    const result = await apply_patch({
      store,
      root_path: project.root_path,
      reindex,
      path: 'src/greeter.ts',
      edits: [
        { old_text: 'hello', new_text: 'good day' },
        { old_text: 'good day', new_text: 'howdy' },
      ],
    });

    expect(result.edits_applied).toBe(2);
    expect(on_disk('src/greeter.ts')).toContain('howdy');
  });

  it('refuses an edit that does not match', async () => {
    await expect(
      apply_patch({
        store,
        root_path: project.root_path,
        reindex,
        path: 'src/greeter.ts',
        edits: [{ old_text: 'nope', new_text: 'x' }],
      }),
    ).rejects.toThrow(/did not match/);
    expect(on_disk('src/greeter.ts')).toBe(FILES['src/greeter.ts']);
  });

  it('refuses an ambiguous edit without writing', async () => {
    // `name` occurs twice in the original file: in the signature and in the template.
    await expect(
      apply_patch({
        store,
        root_path: project.root_path,
        reindex,
        path: 'src/greeter.ts',
        edits: [{ old_text: 'name', new_text: 'friend' }],
      }),
    ).rejects.toThrow(/ambiguous/);
    expect(on_disk('src/greeter.ts')).toBe(FILES['src/greeter.ts']);
  });

  it('refuses to edit a file that changed on disk since indexing', async () => {
    project.write_file('src/greeter.ts', `${FILES['src/greeter.ts']}\n// drift\n`);

    await expect(
      apply_patch({
        store,
        root_path: project.root_path,
        reindex,
        path: 'src/greeter.ts',
        edits: [{ old_text: 'hello', new_text: 'hi' }],
      }),
    ).rejects.toThrow(/changed on disk/);
  });

  it('refuses a path that escapes the project root', async () => {
    await expect(
      apply_patch({
        store,
        root_path: project.root_path,
        reindex,
        path: '../escape.ts',
        edits: [{ old_text: 'x', new_text: 'y' }],
      }),
    ).rejects.toThrow(/not a project-relative path/);
  });
});

describe('resolve_project_path', () => {
  it('resolves a POSIX relative path inside the root', () => {
    expect(resolve_project_path(project.root_path, 'src/greeter.ts')).toBe(
      join(project.root_path, 'src', 'greeter.ts'),
    );
  });

  it('refuses an absolute path', () => {
    expect(() => resolve_project_path(project.root_path, 'C:/elsewhere/a.ts')).toThrow(
      /not a project-relative path/,
    );
  });
});
