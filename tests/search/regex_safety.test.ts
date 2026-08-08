import { describe, expect, it } from 'vitest';
import { code_intelligence_error } from '../../src/core/errors.js';
import { assert_regex_is_safe, has_nested_quantifier } from '../../src/search/regex_safety.js';

describe('has_nested_quantifier: dangerous patterns', () => {
  it.each([
    ['(a+)+', 'the textbook case'],
    ['(a*)*', 'star inside star'],
    ['(a+)*', 'mixed quantifiers'],
    ['(a*)+', 'mixed the other way'],
    ['(\\w+)+', 'with a character class shorthand'],
    ['(x+)+$', 'anchored, the measured 15-second case'],
    ['^(\\s*)*$', 'whitespace, a common accident'],
    ['([a-z]+)+', 'explicit character class inside'],
    ['((a+))+', 'nested groups'],
    ['(a+){2,}', 'unbounded braced quantifier outside'],
    ['(a{2,})+', 'unbounded braced quantifier inside'],
    ['(ab+c)*', 'quantifier not at the group edge'],
  ])('rejects %s (%s)', (pattern) => {
    expect(has_nested_quantifier(pattern)).toBe(true);
  });
});

describe('has_nested_quantifier: safe patterns', () => {
  it.each([
    ['create_\\w+', 'an ordinary search'],
    ['^export class', 'anchored literal'],
    ['(foo|bar)', 'alternation with no quantifier'],
    ['(foo|bar)+', 'quantified group with no inner quantifier'],
    ['a+b+', 'sequential quantifiers, not nested'],
    ['(a)+', 'quantified group containing no quantifier'],
    ['(a+)', 'inner quantifier but no outer one'],
    ['(a{1,3})+', 'bounded inner quantifier'],
    ['(a+){1,3}', 'bounded outer quantifier'],
    ['[+*]+', 'quantifier characters inside a character class'],
    ['\\(a+\\)+', 'escaped parentheses are literals, not a group'],
    ['[(]a+[)]+', 'bracketed parentheses are literals'],
    ['', 'empty'],
    ['a)b', 'unbalanced closing parenthesis'],
  ])('accepts %s (%s)', (pattern) => {
    expect(has_nested_quantifier(pattern)).toBe(false);
  });
});

describe('assert_regex_is_safe', () => {
  it('throws a typed error with a rewrite hint', () => {
    try {
      assert_regex_is_safe('(a+)+$');
      expect.unreachable('assert_regex_is_safe should have thrown');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(code_intelligence_error);
      expect((error as code_intelligence_error).code).toBe('unsafe_pattern');
      expect((error as code_intelligence_error).hint).toContain('a+');
    }
  });

  it('allows an ordinary pattern through', () => {
    expect(() => assert_regex_is_safe('create_\\w+')).not.toThrow();
  });
});

describe('regex safety in practice', () => {
  it('refuses the pattern fast instead of running it', () => {
    // The whole point: `(a+)+$` against a 30 character line takes 15 seconds if
    // it is allowed to run. Rejection has to be immediate.
    const started_at = Date.now();

    expect(() => assert_regex_is_safe('(a+)+$')).toThrowError(code_intelligence_error);

    expect(Date.now() - started_at).toBeLessThan(100);
  });

  it('inspects a long pattern quickly', () => {
    const started_at = Date.now();
    has_nested_quantifier('(abc|def)'.repeat(100));

    expect(Date.now() - started_at).toBeLessThan(100);
  });
});
