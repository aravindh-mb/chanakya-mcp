import { describe, expect, it } from 'vitest';
import { create_logger, type log_level } from '../../src/core/logger.js';

function collect(level: log_level): string[] {
  const lines: string[] = [];
  const logger = create_logger({ level, write: (line) => void lines.push(line) });

  logger.error('an error');
  logger.warn('a warning');
  logger.info('some info');
  logger.debug('a debug note');

  return lines;
}

describe('create_logger', () => {
  it('emits nothing at the silent level', () => {
    expect(collect('silent')).toEqual([]);
  });

  it('emits only errors at the error level', () => {
    expect(collect('error')).toEqual(['[chanakya] error: an error']);
  });

  it('emits errors, warnings and info at the info level', () => {
    expect(collect('info')).toHaveLength(3);
  });

  it('emits everything at the debug level', () => {
    expect(collect('debug')).toHaveLength(4);
  });

  it('appends string details', () => {
    const lines: string[] = [];
    create_logger({ level: 'info', write: (line) => void lines.push(line) }).info('scanned', 'src/index.ts');

    expect(lines[0]).toBe('[chanakya] info: scanned src/index.ts');
  });

  it('serialises object details as JSON', () => {
    const lines: string[] = [];
    create_logger({ level: 'info', write: (line) => void lines.push(line) }).info('stats', { files: 12 });

    expect(lines[0]).toContain('{"files":12}');
  });

  it('exposes the configured level', () => {
    expect(create_logger({ level: 'warn' }).level).toBe('warn');
  });
});
