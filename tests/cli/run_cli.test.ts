import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run_cli } from '../../src/cli/run_cli.js';
import { EXIT_CODE } from '../../src/cli/types.js';
import { read_package_meta } from '../../src/core/package_meta.js';

interface capture {
  readonly stdout: string[];
  readonly stderr: string[];
}

function create_capture(): capture {
  return { stdout: [], stderr: [] };
}

async function run(argv: readonly string[], cwd: string, sink: capture): Promise<number> {
  return run_cli({
    argv,
    cwd,
    write_stdout: (text) => void sink.stdout.push(text),
    write_stderr: (text) => void sink.stderr.push(text),
  });
}

let temp_dir: string;

beforeAll(() => {
  temp_dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'code-intelligence-cli-')));
});

afterAll(() => {
  rmSync(temp_dir, { recursive: true, force: true });
});

describe('run_cli', () => {
  it('starts successfully with no arguments', async () => {
    const sink = create_capture();

    expect(await run([], temp_dir, sink)).toBe(EXIT_CODE.success);
    expect(sink.stderr.join('')).toContain(temp_dir);
    expect(sink.stdout).toHaveLength(0);
  });

  it('starts successfully with an explicit project path', async () => {
    const sink = create_capture();

    expect(await run([temp_dir], process.cwd(), sink)).toBe(EXIT_CODE.success);
    expect(sink.stderr.join('')).toContain(`project root: ${temp_dir}`);
  });

  it('prints help on stdout and exits successfully', async () => {
    const sink = create_capture();

    expect(await run(['--help'], temp_dir, sink)).toBe(EXIT_CODE.success);
    expect(sink.stdout.join('')).toContain('USAGE');
    expect(sink.stderr).toHaveLength(0);
  });

  it('prints the package version on stdout', async () => {
    const sink = create_capture();

    expect(await run(['--version'], temp_dir, sink)).toBe(EXIT_CODE.success);
    expect(sink.stdout.join('').trim()).toBe(read_package_meta().version);
  });

  it('never writes diagnostics to stdout', async () => {
    const sink = create_capture();

    await run(['--verbose'], temp_dir, sink);

    expect(sink.stdout).toHaveLength(0);
  });

  it('suppresses info logs at --quiet', async () => {
    const sink = create_capture();

    expect(await run(['--quiet'], temp_dir, sink)).toBe(EXIT_CODE.success);
    expect(sink.stderr).toHaveLength(0);
  });

  it('returns the usage exit code for an unknown option', async () => {
    const sink = create_capture();

    expect(await run(['--nope'], temp_dir, sink)).toBe(EXIT_CODE.usage_error);
    expect(sink.stderr.join('')).toContain('Unknown option: --nope');
    expect(sink.stderr.join('')).toContain('--help');
  });

  it('returns the runtime exit code for a missing project path', async () => {
    const sink = create_capture();
    const missing = join(temp_dir, 'nowhere');

    expect(await run([missing], temp_dir, sink)).toBe(EXIT_CODE.runtime_error);
    expect(sink.stderr.join('')).toContain('does not exist');
  });

  it('reports what the scanner found', async () => {
    const sink = create_capture();

    await run([], temp_dir, sink);

    expect(sink.stderr.join('')).toMatch(/found \d+ source files/);
  });

  it('includes the fix hint in error output', async () => {
    const sink = create_capture();

    await run([join(temp_dir, 'nowhere')], temp_dir, sink);

    expect(sink.stderr.join('')).toContain('Check the path');
  });
});
