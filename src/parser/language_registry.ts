/**
 * Maps our `language_id` values onto tree-sitter grammars.
 *
 * This module and `syntax_node.ts` are the only two files in the package that
 * import tree-sitter. Everything else goes through the `parsed_file` /
 * `syntax_node` abstraction, so the backend stays replaceable.
 *
 * Backend choice: the native bindings, not WASM. They ship N-API prebuilds for
 * darwin/linux/win32 on x64 and arm64, so a plain `npx` install compiles
 * nothing, and they track current grammar releases. The `.wasm` builds that
 * were available carry older grammars that mis-parse modern TypeScript such as
 * `accessor` fields. If a platform without prebuilds ever needs support, the
 * grammar packages also ship current `.wasm` files and only this file changes.
 */

import Parser from 'tree-sitter';
import javascript_grammar from 'tree-sitter-javascript';
import typescript_grammars from 'tree-sitter-typescript';
import { code_intelligence_error, describe_unknown_error } from '../core/errors.js';
import type { language_id } from '../scanner/language.js';

/**
 * `jsx` deliberately maps to the JavaScript grammar: tree-sitter's JavaScript
 * grammar parses JSX natively, so there is no separate JSX grammar to load.
 * TypeScript is the opposite — `.ts` and `.tsx` genuinely need different
 * grammars, which is why they are distinct language ids.
 */
const GRAMMAR_BY_LANGUAGE: Readonly<Record<language_id, Parser.Language>> = {
  javascript: javascript_grammar as Parser.Language,
  jsx: javascript_grammar as Parser.Language,
  typescript: typescript_grammars.typescript as Parser.Language,
  tsx: typescript_grammars.tsx as Parser.Language,
};

/**
 * Parsers are stateful but reusable, and constructing one plus binding a
 * grammar is the expensive part. Caching one per language keeps repeated
 * parses cheap. Reuse is safe because parsing is synchronous and this package
 * never parses two files concurrently on one parser.
 */
const parser_cache = new Map<language_id, Parser>();

export function get_grammar(language: language_id): Parser.Language {
  const grammar = GRAMMAR_BY_LANGUAGE[language];
  if (grammar === undefined) {
    throw new code_intelligence_error({
      code: 'unsupported_language',
      message: `No tree-sitter grammar is registered for language: ${language}`,
      hint: `Supported languages are: ${Object.keys(GRAMMAR_BY_LANGUAGE).join(', ')}.`,
    });
  }
  return grammar;
}

export function get_parser(language: language_id): Parser {
  const cached = parser_cache.get(language);
  if (cached !== undefined) {
    return cached;
  }

  const parser = new Parser();
  try {
    parser.setLanguage(get_grammar(language));
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'parser_unavailable',
      message: `The tree-sitter grammar for ${language} could not be loaded: ${describe_unknown_error(cause)}`,
      hint: 'This usually means the native tree-sitter build does not match this platform or Node version.',
      cause,
    });
  }

  parser_cache.set(language, parser);
  return parser;
}

/** Drop cached parsers. Exposed for tests and for long-running processes. */
export function reset_parser_cache(): void {
  parser_cache.clear();
}
