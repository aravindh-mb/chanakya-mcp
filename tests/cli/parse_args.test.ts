import { describe, expect, it } from 'vitest';
import { parse_args } from '../../src/cli/parse_args.js';
import { code_intelligence_error } from '../../src/core/errors.js';

describe('parse_args', () => {
  it('returns defaults when no arguments are given', () => {
    const options = parse_args([]);

    expect(options).toEqual({
      project_path: undefined,
      log_level: 'info',
      show_help: false,
      show_version: false,
      watch: false,
      force: false,
    });
  });

  it('reads a positional project path', () => {
    expect(parse_args(['/path/to/project']).project_path).toBe('/path/to/project');
  });

  it('reads a relative project path', () => {
    expect(parse_args(['./apps/api']).project_path).toBe('./apps/api');
  });

  it.each([
    ['-h', 'show_help'],
    ['--help', 'show_help'],
    ['-v', 'show_version'],
    ['--version', 'show_version'],
  ] as const)('sets %s', (flag, field) => {
    expect(parse_args([flag])[field]).toBe(true);
  });

  it.each(['-w', '--watch'])('sets watch via %s', (flag) => {
    expect(parse_args([flag]).watch).toBe(true);
  });

  it('sets force via --force', () => {
    expect(parse_args(['--force']).force).toBe(true);
  });

  it('combines watch with a project path', () => {
    const options = parse_args(['./app', '--watch']);

    expect(options.project_path).toBe('./app');
    expect(options.watch).toBe(true);
  });

  it('maps --verbose to the debug level', () => {
    expect(parse_args(['--verbose']).log_level).toBe('debug');
  });

  it('maps --quiet to the error level', () => {
    expect(parse_args(['--quiet']).log_level).toBe('error');
  });

  it('accepts --log-level with a separate value', () => {
    expect(parse_args(['--log-level', 'warn']).log_level).toBe('warn');
  });

  it('accepts --log-level with an inline value', () => {
    expect(parse_args(['--log-level=silent']).log_level).toBe('silent');
  });

  it('combines a path and flags in any order', () => {
    const options = parse_args(['--verbose', './project', '--help']);

    expect(options.project_path).toBe('./project');
    expect(options.log_level).toBe('debug');
    expect(options.show_help).toBe(true);
  });

  it('treats arguments after -- as the project path', () => {
    expect(parse_args(['--', '--weird-directory-name']).project_path).toBe('--weird-directory-name');
  });

  it('rejects an unknown option', () => {
    expect(() => parse_args(['--nope'])).toThrowError(code_intelligence_error);
    expect(() => parse_args(['--nope'])).toThrowError(/Unknown option: --nope/);
  });

  it('rejects a second positional argument', () => {
    expect(() => parse_args(['a', 'b'])).toThrowError(/Unexpected extra argument: b/);
  });

  it('rejects an invalid log level', () => {
    expect(() => parse_args(['--log-level', 'loud'])).toThrowError(/Invalid value for --log-level: loud/);
  });

  it('rejects a missing log level value', () => {
    expect(() => parse_args(['--log-level'])).toThrowError(/Invalid value for --log-level: <missing>/);
  });

  it('rejects a value attached to a boolean flag', () => {
    expect(() => parse_args(['--verbose=1'])).toThrowError(/does not take a value/);
  });

  it('reports usage errors with the invalid_usage code', () => {
    try {
      parse_args(['--nope']);
      expect.unreachable('parse_args should have thrown');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(code_intelligence_error);
      expect((error as code_intelligence_error).code).toBe('invalid_usage');
    }
  });
});
