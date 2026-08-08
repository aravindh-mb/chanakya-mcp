/**
 * Minimal leveled logger.
 *
 * IMPORTANT: every log line goes to stderr, never stdout.
 * Later phases speak the MCP protocol over stdio, and stdout is reserved
 * exclusively for JSON-RPC frames. A stray `console.log` corrupts the stream.
 */

import { stringify_safely } from './errors.js';

export type log_level = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<log_level, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export interface logger {
  readonly level: log_level;
  error(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  debug(message: string, ...details: unknown[]): void;
}

export interface logger_options {
  readonly level: log_level;
  /** Sink for log lines. Defaults to stderr. Injected in tests. */
  readonly write?: (line: string) => void;
}

function default_write(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function create_logger(options: logger_options): logger {
  const { level } = options;
  const write = options.write ?? default_write;
  const threshold = LEVEL_RANK[level];

  const emit = (message_level: Exclude<log_level, 'silent'>, message: string, details: unknown[]): void => {
    if (LEVEL_RANK[message_level] > threshold) {
      return;
    }
    const suffix = details.length === 0 ? '' : ` ${details.map(format_detail).join(' ')}`;
    write(`[chanakya] ${message_level}: ${message}${suffix}`);
  };

  return {
    level,
    error: (message, ...details) => emit('error', message, details),
    warn: (message, ...details) => emit('warn', message, details),
    info: (message, ...details) => emit('info', message, details),
    debug: (message, ...details) => emit('debug', message, details),
  };
}

function format_detail(detail: unknown): string {
  if (typeof detail === 'string') {
    return detail;
  }
  if (detail instanceof Error) {
    return detail.stack ?? detail.message;
  }
  return stringify_safely(detail);
}
