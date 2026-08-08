/**
 * CLI orchestration, kept free of `process.exit` so it can be unit tested.
 * `src/cli/main.ts` is the thin executable wrapper around this function.
 */

import { describe_unknown_error, is_code_intelligence_error } from '../core/errors.js';
import { create_logger, type logger } from '../core/logger.js';
import { read_package_meta } from '../core/package_meta.js';
import { resolve_project_root } from '../core/project_root.js';
import { parse_file } from '../parser/parse_file.js';
import { scan_project } from '../scanner/file_scanner.js';
import type { language_id } from '../scanner/language.js';
import type { scan_result } from '../scanner/types.js';
import { build_help_text } from './help_text.js';
import { parse_args } from './parse_args.js';
import { EXIT_CODE, type exit_code } from './types.js';

export const BINARY_NAME = 'code-intelligence-mcp';

export interface run_cli_options {
  /** Arguments after `node` and the script path. */
  readonly argv: readonly string[];
  /** Reserved for protocol output and `--help` / `--version`. */
  readonly write_stdout?: (text: string) => void;
  /** Diagnostics sink. */
  readonly write_stderr?: (text: string) => void;
  readonly cwd?: string;
}

export async function run_cli(options: run_cli_options): Promise<exit_code> {
  const write_stdout = options.write_stdout ?? ((text: string) => void process.stdout.write(text));
  const write_stderr = options.write_stderr ?? ((text: string) => void process.stderr.write(text));

  try {
    const cli_options = parse_args(options.argv);

    if (cli_options.show_help) {
      write_stdout(build_help_text(BINARY_NAME));
      return EXIT_CODE.success;
    }

    const meta = read_package_meta();

    if (cli_options.show_version) {
      write_stdout(`${meta.version}\n`);
      return EXIT_CODE.success;
    }

    const logger = create_logger({
      level: cli_options.log_level,
      write: (line: string) => write_stderr(`${line}\n`),
    });

    const root = resolve_project_root({
      input_path: cli_options.project_path,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });

    logger.info(`${meta.name} v${meta.version}`);
    logger.info(`project root: ${root.root_path}`);
    logger.debug(`data directory: ${root.data_dir_path}`);

    const scan = await scan_project({ root_path: root.root_path });
    report_scan(scan, logger);

    await report_parse(scan, logger);

    logger.info('ok - the symbol model and MCP server are not implemented yet (phase 3 of 20)');

    return EXIT_CODE.success;
  } catch (error: unknown) {
    write_stderr(`${BINARY_NAME}: ${describe_unknown_error(error)}\n`);

    if (is_code_intelligence_error(error) && error.code === 'invalid_usage') {
      write_stderr(`Run \`${BINARY_NAME} --help\` for usage.\n`);
      return EXIT_CODE.usage_error;
    }
    return EXIT_CODE.runtime_error;
  }
}

function report_scan(scan: scan_result, log: logger): void {
  const { stats } = scan;
  log.info(
    `scanned ${stats.directories_scanned} directories in ${stats.duration_ms}ms, ` +
      `found ${stats.files_matched} source files`,
  );

  for (const [language, count] of count_by_language(scan)) {
    log.debug(`  ${language}: ${count}`);
  }

  if (scan.skipped.length > 0) {
    log.info(`skipped ${scan.skipped.length} entries (use --verbose to list them)`);
    for (const entry of scan.skipped) {
      log.debug(`  ${entry.relative_path} [${entry.reason}] ${entry.detail}`);
    }
  }
}

/**
 * Parse every scanned file and summarize.
 *
 * Files are parsed one at a time and the result is discarded immediately: only
 * the counters survive, so memory stays flat regardless of repository size.
 * Phases 6 and 7 replace this with a persistent index.
 */
async function report_parse(scan: scan_result, log: logger): Promise<void> {
  const started_at = Date.now();
  let parsed = 0;
  let with_syntax_errors = 0;
  let failed = 0;

  for (const file of scan.files) {
    try {
      const result = await parse_file({ file_path: file.file_path });
      parsed += 1;
      if (result.has_errors) {
        with_syntax_errors += 1;
        log.debug(
          `  ${file.relative_path}: ${result.parse_errors.length} syntax issue(s), ` +
            `first at line ${result.parse_errors[0]?.range.start.line ?? 0}`,
        );
      }
    } catch (error: unknown) {
      // One unparseable file must not abort the run, but it is reported.
      failed += 1;
      log.warn(`  ${file.relative_path}: ${describe_unknown_error(error)}`);
    }
  }

  log.info(`parsed ${parsed} files in ${Date.now() - started_at}ms`);
  if (with_syntax_errors > 0) {
    log.info(`${with_syntax_errors} file(s) contain syntax errors (still indexable; use --verbose)`);
  }
  if (failed > 0) {
    log.info(`${failed} file(s) could not be parsed at all`);
  }
}

/** Counts per language, ordered highest first, for the startup summary. */
function count_by_language(scan: scan_result): Array<[language_id, number]> {
  const counts = new Map<language_id, number>();
  for (const file of scan.files) {
    counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}
