/**
 * Hand written argv parser.
 *
 * A dedicated CLI framework is not worth a dependency here: the surface is a
 * single optional positional plus a handful of flags, and we want precise
 * error messages rather than a generic parser's output.
 */

import { z } from 'zod';
import { code_intelligence_error } from '../core/errors.js';
import type { log_level } from '../core/logger.js';
import type { cli_options } from './types.js';

const log_level_schema = z.enum(['silent', 'error', 'warn', 'info', 'debug']);

const DEFAULT_LOG_LEVEL: log_level = 'info';

/**
 * Parse process arguments (without `node` and the script path).
 *
 * @throws code_intelligence_error with code `invalid_usage` on bad input.
 */
export function parse_args(argv: readonly string[]): cli_options {
  let project_path: string | undefined;
  let level: log_level = DEFAULT_LOG_LEVEL;
  let show_help = false;
  let show_version = false;
  let flags_terminated = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      continue;
    }

    if (flags_terminated || !argument.startsWith('-') || argument === '-') {
      project_path = take_positional(project_path, argument);
      continue;
    }

    if (argument === '--') {
      flags_terminated = true;
      continue;
    }

    const [flag, inline_value] = split_flag(argument);

    switch (flag) {
      case '-h':
      case '--help':
        reject_inline_value(flag, inline_value);
        show_help = true;
        break;

      case '-v':
      case '--version':
        reject_inline_value(flag, inline_value);
        show_version = true;
        break;

      case '--verbose':
        reject_inline_value(flag, inline_value);
        level = 'debug';
        break;

      case '--quiet':
        reject_inline_value(flag, inline_value);
        level = 'error';
        break;

      case '--log-level': {
        const raw_value = inline_value ?? argv[index + 1];
        if (inline_value === undefined) {
          index += 1;
        }
        level = parse_log_level(raw_value);
        break;
      }

      default:
        throw new code_intelligence_error({
          code: 'invalid_usage',
          message: `Unknown option: ${flag}`,
          hint: 'Run `code-intelligence-mcp --help` to see the supported options.',
        });
    }
  }

  return {
    project_path,
    log_level: level,
    show_help,
    show_version,
  };
}

/** Split `--log-level=debug` into `['--log-level', 'debug']`. */
function split_flag(argument: string): [string, string | undefined] {
  const separator_index = argument.indexOf('=');
  if (separator_index === -1) {
    return [argument, undefined];
  }
  return [argument.slice(0, separator_index), argument.slice(separator_index + 1)];
}

function take_positional(existing: string | undefined, value: string): string {
  if (existing !== undefined) {
    throw new code_intelligence_error({
      code: 'invalid_usage',
      message: `Unexpected extra argument: ${value}`,
      hint: 'Only one project path may be provided.',
    });
  }
  return value;
}

function reject_inline_value(flag: string, inline_value: string | undefined): void {
  if (inline_value !== undefined) {
    throw new code_intelligence_error({
      code: 'invalid_usage',
      message: `Option ${flag} does not take a value.`,
      hint: `Use \`${flag}\` on its own.`,
    });
  }
}

function parse_log_level(raw_value: string | undefined): log_level {
  const parsed = log_level_schema.safeParse(raw_value);
  if (!parsed.success) {
    throw new code_intelligence_error({
      code: 'invalid_usage',
      message: `Invalid value for --log-level: ${raw_value ?? '<missing>'}`,
      hint: `Expected one of: ${log_level_schema.options.join(', ')}.`,
    });
  }
  return parsed.data;
}
