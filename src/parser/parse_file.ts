/**
 * File and string entry points to the parser.
 *
 * Error tolerance is the important property: tree-sitter always produces a
 * tree, so a file with a syntax error still yields usable structure plus a
 * populated `parse_errors`. Refusing to index a file because of one typo would
 * lose far more than it protects.
 */

import { readFile, stat } from 'node:fs/promises';
import { code_intelligence_error, describe_unknown_error } from '../core/errors.js';
import { detect_language } from '../scanner/language.js';
import type { language_id } from '../scanner/language.js';
import { get_parser } from './language_registry.js';
import { wrap_syntax_node } from './syntax_node.js';
import {
  DEFAULT_MAX_PARSE_ERRORS,
  DEFAULT_MAX_SOURCE_BYTES,
  type parse_error,
  type parse_file_options,
  type parse_source_options,
  type parsed_file,
  type syntax_node,
} from './types.js';

/** Parse a source string. Never throws for malformed syntax. */
export function parse_source(options: parse_source_options): parsed_file {
  const language = resolve_language(options.file_path, options.language);
  const parser = get_parser(language);
  const max_parse_errors = options.max_parse_errors ?? DEFAULT_MAX_PARSE_ERRORS;

  let tree;
  try {
    tree = parser.parse(options.source);
  } catch (cause) {
    // Reaching here means the parser itself failed, not that the source was
    // invalid, so it is a genuine error rather than a syntax diagnostic.
    throw new code_intelligence_error({
      code: 'parser_unavailable',
      message: `tree-sitter failed to parse ${options.file_path}: ${describe_unknown_error(cause)}`,
      hint: 'This indicates a parser or platform problem, not a syntax error in the file.',
      cause,
    });
  }

  const root = wrap_syntax_node(tree.rootNode, options.source);
  const parse_errors = root.has_error ? collect_parse_errors(root, max_parse_errors) : [];

  return {
    file_path: options.file_path,
    language,
    root,
    parse_errors,
    source: options.source,
    has_errors: parse_errors.length > 0,
  };
}

/** Read and parse a file. Rejects unreadable or oversized files. */
export async function parse_file(options: parse_file_options): Promise<parsed_file> {
  const max_source_bytes = options.max_source_bytes ?? DEFAULT_MAX_SOURCE_BYTES;
  // Resolve the language before reading, so an unsupported file costs no I/O.
  const language = resolve_language(options.file_path, options.language);

  let size: number;
  try {
    size = (await stat(options.file_path)).size;
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'file_not_readable',
      message: `The file could not be inspected: ${options.file_path}`,
      hint: 'Check that the path exists and is readable.',
      cause,
    });
  }

  if (size > max_source_bytes) {
    throw new code_intelligence_error({
      code: 'source_too_large',
      message: `The file is ${size} bytes, over the ${max_source_bytes} byte parse limit: ${options.file_path}`,
      hint: 'Raise max_source_bytes if this file really should be indexed.',
    });
  }

  let source: string;
  try {
    source = await readFile(options.file_path, 'utf8');
  } catch (cause) {
    throw new code_intelligence_error({
      code: 'file_not_readable',
      message: `The file could not be read: ${options.file_path}`,
      hint: 'Check file permissions.',
      cause,
    });
  }

  return parse_source({
    source,
    file_path: options.file_path,
    language,
    ...(options.max_parse_errors === undefined ? {} : { max_parse_errors: options.max_parse_errors }),
  });
}

function resolve_language(file_path: string, explicit_language: language_id | undefined): language_id {
  if (explicit_language !== undefined) {
    return explicit_language;
  }

  const detected = detect_language(file_path);
  if (detected === undefined) {
    throw new code_intelligence_error({
      code: 'unsupported_language',
      message: `Cannot determine a supported language for: ${file_path}`,
      hint: 'Supported extensions are .js, .mjs, .cjs, .jsx, .ts, .mts, .cts and .tsx. Pass `language` to override.',
    });
  }
  return detected;
}

/**
 * Walk the tree for error and missing nodes.
 *
 * Only called when the root reports an error, so clean files pay nothing. The
 * cap stops a badly broken file from producing an unbounded diagnostic list.
 */
function collect_parse_errors(root: syntax_node, max_parse_errors: number): parse_error[] {
  const errors: parse_error[] = [];

  for (const node of root.walk()) {
    if (errors.length >= max_parse_errors) {
      break;
    }

    if (node.is_missing) {
      errors.push({
        kind: 'missing',
        message: `Missing ${node.type}`,
        range: node.range,
      });
      continue;
    }

    if (node.type === 'ERROR') {
      errors.push({
        kind: 'error',
        message: `Unexpected syntax`,
        range: node.range,
      });
    }
  }

  return errors;
}
