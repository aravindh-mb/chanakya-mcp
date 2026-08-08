import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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

async function run(argv: readonly string[], cwd: string, sink: capture, stdin?: Readable): Promise<number> {
  return run_cli({
    argv,
    cwd,
    write_stdout: (text) => void sink.stdout.push(text),
    write_stderr: (text) => void sink.stderr.push(text),
    stdin: stdin ?? Readable.from([]),
  });
}

let temp_dir: string;

beforeAll(() => {
  temp_dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'chanakya-cli-')));
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

  it('reports what was indexed', async () => {
    const sink = create_capture();

    expect(await run([], temp_dir, sink)).toBe(EXIT_CODE.success);
    expect(sink.stderr.join('')).toMatch(/\d+ added, \d+ updated, \d+ removed, \d+ unchanged/);
    expect(sink.stderr.join('')).toMatch(/\d+ symbols/);
  });

  it('creates the index inside the project', async () => {
    const sink = create_capture();

    await run([], temp_dir, sink);

    expect(existsSync(join(temp_dir, '.chanakya', 'index.db'))).toBe(true);
  });

  it('releases the database handle so a second run succeeds', async () => {
    // Windows keeps the file locked while a handle is open, so a leaked handle
    // would make every run after the first fail.
    const sink = create_capture();

    expect(await run([], temp_dir, sink)).toBe(EXIT_CODE.success);
    expect(await run([], temp_dir, sink)).toBe(EXIT_CODE.success);
  });

  it('includes the fix hint in error output', async () => {
    const sink = create_capture();

    await run([join(temp_dir, 'nowhere')], temp_dir, sink);

    expect(sink.stderr.join('')).toContain('Check the path');
  });

  it('serves MCP requests on stdout and shuts down at EOF', async () => {
    writeFileSync(join(temp_dir, 'lib.js'), 'export function greet(name) { return `hi ${name}`; }\n');
    const sink = create_capture();

    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search_symbols', arguments: { query: 'greet' } },
      },
    ];
    const stdin = Readable.from([requests.map((request) => JSON.stringify(request)).join('\n')]);

    expect(await run([], temp_dir, sink, stdin)).toBe(EXIT_CODE.success);

    const responses = sink.stdout.map((line) => JSON.parse(line));
    expect(responses).toHaveLength(3);
    expect(responses[0].result.protocolVersion).toBe('2025-06-18');
    expect(responses[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'search_symbols',
      'search_code',
      'get_symbol',
      'get_file_structure',
      'find_definition',
      'find_references',
      'get_callers',
      'get_callees',
      'get_dependencies',
      'get_dependents',
      'get_symbol_context',
      'apply_patch',
      'replace_symbol',
      'rename_symbol',
    ]);
    const symbol_result = JSON.parse(responses[2].result.content[0].text);
    expect(symbol_result.symbols[0].name).toBe('greet');
  });

  it('applies an edit tool over MCP and reindexes', async () => {
    const dir = join(temp_dir, 'rename-e2e');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'lib.js'), 'export class widget {\n  constructor() {}\n}\n');
    writeFileSync(
      join(dir, 'app.js'),
      "import { widget } from './lib.js';\n\nexport function run() {\n  return new widget();\n}\n",
    );
    const sink = create_capture();
    const stdin = new Readable({ read() {} });

    const exit = run([dir], temp_dir, sink, stdin);

    const wait_for = async (
      id: number,
    ): Promise<{ result?: { content: Array<{ text: string }>; isError?: boolean } }> => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const response = sink.stdout
          .map(
            (line) =>
              JSON.parse(line) as {
                id: number;
                result?: { content: Array<{ text: string }>; isError?: boolean };
              },
          )
          .find((item) => item.id === id);
        if (response !== undefined) {
          return response;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`no response with id ${id}`);
    };

    stdin.push(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    stdin.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search_symbols', arguments: { query: 'widget' } },
      }) + '\n',
    );

    const search = await wait_for(2);
    const symbol_id = (JSON.parse(search.result!.content[0]!.text) as { symbols: Array<{ id: string }> })
      .symbols[0]!.id;

    stdin.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'rename_symbol', arguments: { id: symbol_id, new_name: 'gadget' } },
      }) + '\n',
    );

    const rename = await wait_for(3);
    const rename_result = JSON.parse(rename.result!.content[0]!.text) as {
      total_changes: number;
      new_name: string;
    };
    expect(rename.result!.isError).toBeUndefined();
    expect(rename_result.new_name).toBe('gadget');
    expect(rename_result.total_changes).toBe(3);

    const lib = readFileSync(join(dir, 'lib.js'), 'utf8');
    const app = readFileSync(join(dir, 'app.js'), 'utf8');
    expect(lib).toContain('class gadget');
    expect(app).toContain("import { gadget } from './lib.js'");
    expect(app).toContain('new gadget()');
    expect(app).not.toContain('widget');

    stdin.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'search_symbols', arguments: { query: 'widget' } },
      }) + '\n',
    );
    const rechecked = await wait_for(4);
    const recheck_result = JSON.parse(rechecked.result!.content[0]!.text) as { symbols: unknown[] };
    expect(recheck_result.symbols).toHaveLength(0);

    stdin.push(null);
    expect(await exit).toBe(EXIT_CODE.success);
  });
});
