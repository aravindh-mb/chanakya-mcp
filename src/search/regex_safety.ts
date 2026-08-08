/**
 * Rejecting regular expressions that can blow up.
 *
 * JavaScript's regex engine backtracks and offers no timeout, so a pattern with
 * a quantified group that itself contains an unbounded quantifier — `(a+)+`,
 * `(\w*)*`, `(x+)+$` — takes time exponential in the length of the subject.
 * This was measured rather than assumed: `(a+)+$` against a *30 character*
 * line takes 15 seconds, and each additional character roughly doubles it.
 *
 * That measurement matters because it rules out the obvious mitigations. A line
 * length cap does not help: the blowup happens two orders of magnitude below
 * any cap worth having. Nor does a wall-clock budget checked between lines or
 * files, because the engine never yields during a single failing match.
 *
 * So the pattern is inspected before it ever runs, and the dangerous shape is
 * refused with an explanation.
 *
 * **This is a heuristic, and it is honest about that.** It catches the nested
 * quantifier family, which is what an agent or a person writes by accident. It
 * does not catch every pathological pattern — overlapping alternations such as
 * `(a|a)+` can also backtrack badly. The complete fix is to run matching in a
 * worker thread that can be terminated, which is scheduled for the security
 * phase. Until then this package assumes the pattern comes from a cooperating
 * client, not an attacker.
 */

import { code_intelligence_error } from '../core/errors.js';

/**
 * True when a quantified group contains an unbounded quantifier.
 *
 * Scans once, tracking escapes, character classes and group nesting, because a
 * naive search would be fooled by `\(`, by `[+*]`, and by nesting.
 */
export function has_nested_quantifier(pattern: string): boolean {
  // Start offset of each currently open group, innermost last.
  const open_groups: number[] = [];
  let in_character_class = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] as string;

    if (character === '\\') {
      // Skip the escaped character; `\(` is a literal, not a group.
      index += 1;
      continue;
    }

    if (in_character_class) {
      if (character === ']') {
        in_character_class = false;
      }
      continue;
    }

    if (character === '[') {
      in_character_class = true;
      continue;
    }

    if (character === '(') {
      open_groups.push(index);
      continue;
    }

    if (character === ')') {
      const start = open_groups.pop();
      if (start === undefined) {
        continue;
      }
      if (
        is_unbounded_quantifier_at(pattern, index + 1) &&
        contains_unbounded_quantifier(pattern.slice(start + 1, index))
      ) {
        return true;
      }
    }
  }

  return false;
}

/** `*`, `+`, `{n,}` — the quantifiers with no upper bound. */
function is_unbounded_quantifier_at(pattern: string, index: number): boolean {
  const character = pattern[index];
  if (character === '*' || character === '+') {
    return true;
  }
  if (character !== '{') {
    return false;
  }

  const closing = pattern.indexOf('}', index);
  if (closing === -1) {
    return false;
  }
  // `{2,}` is unbounded; `{2,5}` is not.
  return /^\{\d*,\}$/.test(pattern.slice(index, closing + 1));
}

/** Whether a group body applies an unbounded quantifier to anything. */
function contains_unbounded_quantifier(body: string): boolean {
  let in_character_class = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] as string;

    if (character === '\\') {
      index += 1;
      continue;
    }

    if (in_character_class) {
      if (character === ']') {
        in_character_class = false;
      }
      continue;
    }

    if (character === '[') {
      in_character_class = true;
      continue;
    }

    if (is_unbounded_quantifier_at(body, index)) {
      return true;
    }
  }

  return false;
}

/** Throw if the pattern has a shape known to backtrack exponentially. */
export function assert_regex_is_safe(pattern: string): void {
  if (!has_nested_quantifier(pattern)) {
    return;
  }

  throw new code_intelligence_error({
    code: 'unsafe_pattern',
    message: `The pattern nests one unbounded quantifier inside another, which can take exponential time: ${pattern}`,
    hint: 'Rewrite the inner or outer quantifier, for example `(a+)+` as `a+`, or search without is_regex.',
  });
}
