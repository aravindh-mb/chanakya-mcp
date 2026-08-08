import { afterEach, describe, expect, it } from 'vitest';
import { code_intelligence_error } from '../../src/core/errors.js';
import { parse_file } from '../../src/parser/parse_file.js';
import { create_temp_project, type temp_project } from '../helpers/temp_project.js';

let project: temp_project | undefined;

afterEach(() => {
  project?.cleanup();
  project = undefined;
});

function make_project(files: Readonly<Record<string, string>>): temp_project {
  project = create_temp_project(files);
  return project;
}

async function expect_error_code(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('parse_file should have thrown');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(code_intelligence_error);
    expect((error as code_intelligence_error).code).toBe(code);
  }
}

describe('parse_file', () => {
  it('reads and parses a file from disk', async () => {
    const temp = make_project({ 'src/user.ts': 'export class user_service {\n  create_user() {}\n}\n' });

    const result = await parse_file({ file_path: temp.resolve_path('src/user.ts') });

    expect(result.language).toBe('typescript');
    expect(result.has_errors).toBe(false);
    expect(result.file_path).toBe(temp.resolve_path('src/user.ts'));
    expect(result.source).toContain('create_user');
  });

  it('detects the language from the extension', async () => {
    const temp = make_project({
      'a.js': 'const a = 1;\n',
      'b.tsx': 'export const B = () => <div />;\n',
    });

    expect((await parse_file({ file_path: temp.resolve_path('a.js') })).language).toBe('javascript');
    expect((await parse_file({ file_path: temp.resolve_path('b.tsx') })).language).toBe('tsx');
  });

  it('reads UTF-8 content correctly', async () => {
    const temp = make_project({ 'a.ts': 'const café = "🎉";\nfunction target() {}\n' });

    const result = await parse_file({ file_path: temp.resolve_path('a.ts') });
    const target = [...result.root.walk()].find((node) => node.type === 'function_declaration');

    expect(result.has_errors).toBe(false);
    expect(target?.text).toBe('function target() {}');
  });

  it('parses a file with syntax errors instead of throwing', async () => {
    const temp = make_project({ 'broken.ts': 'function broken( {\n' });

    const result = await parse_file({ file_path: temp.resolve_path('broken.ts') });

    expect(result.has_errors).toBe(true);
    expect(result.parse_errors.length).toBeGreaterThan(0);
  });

  it('rejects a file that does not exist', async () => {
    const temp = make_project({});

    await expect_error_code(parse_file({ file_path: temp.resolve_path('missing.ts') }), 'file_not_readable');
  });

  it('rejects a file over the size limit', async () => {
    const temp = make_project({ 'big.ts': `const a = "${'x'.repeat(5000)}";\n` });

    await expect_error_code(
      parse_file({ file_path: temp.resolve_path('big.ts'), max_source_bytes: 1000 }),
      'source_too_large',
    );
  });

  it('rejects an unsupported extension without reading the file', async () => {
    const temp = make_project({ 'styles.css': 'body { color: red }\n' });

    await expect_error_code(
      parse_file({ file_path: temp.resolve_path('styles.css') }),
      'unsupported_language',
    );
  });

  it('accepts an explicit language for an unusual extension', async () => {
    const temp = make_project({ 'script.txt': 'export const a = 1;\n' });

    const result = await parse_file({
      file_path: temp.resolve_path('script.txt'),
      language: 'typescript',
    });

    expect(result.has_errors).toBe(false);
  });
});
