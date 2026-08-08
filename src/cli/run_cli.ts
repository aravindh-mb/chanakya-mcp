/**
 * CLI orchestration, kept free of `process.exit` so it can be unit tested.
 * `src/cli/main.ts` is the thin executable wrapper around this function.
 */

import { describe_unknown_error, is_code_intelligence_error } from '../core/errors.js';
import { create_logger, type logger } from '../core/logger.js';
import { read_package_meta } from '../core/package_meta.js';
import { resolve_project_root, type project_root } from '../core/project_root.js';
import { index_project } from '../indexer/index_project.js';
import { index_store } from '../store/index_store.js';
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

    await build_index(root, meta.version, logger);

    logger.info('ok - incremental indexing and the MCP server are not implemented yet (phase 6 of 20)');

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

/**
 * Build the on-disk index and report what it contains.
 *
 * The store is closed in a `finally` block: leaving a SQLite handle open would
 * strand the WAL files, and on Windows would keep the database locked against
 * the next run.
 */
async function build_index(root: project_root, tool_version: string, log: logger): Promise<void> {
  const store = index_store.open({
    data_dir_path: root.data_dir_path,
    project_root: root.root_path,
    tool_version,
  });

  try {
    const result = await index_project({ store, root_path: root.root_path, logger: log });
    const counts = store.count();

    log.info(
      `indexed ${result.files_indexed} files in ${result.duration_ms}ms: ` +
        `${counts.symbols} symbols, ${counts.relationships} relationships`,
    );
    log.debug(`index written to ${root.data_dir_path}`);

    if (result.files_with_syntax_errors > 0) {
      log.info(`${result.files_with_syntax_errors} file(s) had syntax errors but were still indexed`);
    }

    if (result.files_failed > 0) {
      log.info(`${result.files_failed} file(s) could not be indexed (use --verbose for details)`);
      for (const failure of result.failures) {
        log.debug(`  ${failure.relative_path}: ${failure.reason}`);
      }
    }
  } finally {
    store.close();
  }
}
