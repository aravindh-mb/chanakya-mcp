import { describe, expect, it } from 'vitest';
import {
  code_intelligence_error,
  describe_unknown_error,
  is_code_intelligence_error,
  stringify_safely,
} from '../../src/core/errors.js';

describe('code_intelligence_error', () => {
  it('carries a code, message and hint', () => {
    const error = new code_intelligence_error({
      code: 'invalid_usage',
      message: 'bad flag',
      hint: 'see --help',
    });

    expect(error.code).toBe('invalid_usage');
    expect(error.message).toBe('bad flag');
    expect(error.hint).toBe('see --help');
    expect(error).toBeInstanceOf(Error);
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('enoent');
    const error = new code_intelligence_error({ code: 'internal_error', message: 'wrapped', cause });

    expect(error.cause).toBe(cause);
  });
});

describe('is_code_intelligence_error', () => {
  it('accepts its own errors and rejects others', () => {
    expect(
      is_code_intelligence_error(new code_intelligence_error({ code: 'internal_error', message: 'x' })),
    ).toBe(true);
    expect(is_code_intelligence_error(new Error('x'))).toBe(false);
    expect(is_code_intelligence_error('x')).toBe(false);
  });
});

describe('describe_unknown_error', () => {
  it('appends the hint for package errors', () => {
    const error = new code_intelligence_error({
      code: 'invalid_usage',
      message: 'bad flag',
      hint: 'see --help',
    });

    expect(describe_unknown_error(error)).toBe('bad flag (see --help)');
  });

  it('omits the parentheses when there is no hint', () => {
    const error = new code_intelligence_error({ code: 'invalid_usage', message: 'bad flag' });

    expect(describe_unknown_error(error)).toBe('bad flag');
  });

  it('handles plain errors, strings and unknown values', () => {
    expect(describe_unknown_error(new Error('boom'))).toBe('boom');
    expect(describe_unknown_error('boom')).toBe('boom');
    expect(describe_unknown_error({ a: 1 })).toBe('{"a":1}');
    expect(describe_unknown_error(undefined)).toBe('undefined');
    expect(describe_unknown_error(null)).toBe('null');
  });
});

describe('stringify_safely', () => {
  it('always returns a string, even where JSON.stringify does not', () => {
    expect(stringify_safely(undefined)).toBe('undefined');
    expect(stringify_safely(() => 1)).toContain('1');
    expect(stringify_safely({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });

  it('falls back to String() on circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(stringify_safely(circular)).toBe('[object Object]');
  });
});
