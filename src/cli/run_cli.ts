/**
 * CLI orchestration, kept free of `process.exit` so it can be unit tested.
 * `src/cli/main.ts` is the thin executable wrapper around this function.
 */

import { describe_unknown_error, is_code_intelligence_error } from '../core/errors.js';
import { create_logger, type logger } from '../core/logger.js';
import { read_package_meta } from '../core/package_meta.js';
import { resolve_project_root, type project_root } from '../core/project_root.js';
import { index_project, type index_project_result } from '../indexer/index_project.js';
import { watch_project } from '../indexer/watch_project.js';
import { run_mcp_server } from '../mcp/run.js';
import { index_store } from '../store/index_store.js';
import { build_help_text } from './help_text.js';
import { parse_args } from './parse_args.js';
import { EXIT_CODE, type cli_options as cli_options_type, type exit_code } from './types.js';
import type { Readable } from 'node:stream';

export const BINARY_NAME = 'code-intelligence-mcp';

export interface run_cli_options {
  /** Arguments after `node` and the script path. */
  readonly argv: readonly string[];
  /** Reserved for protocol output and `--help` / `--version`. */
  readonly write_stdout?: (text: string) => void;
  /** Diagnostics sink. */
  readonly write_stderr?: (text: string) => void;
  readonly cwd?: string;
  /** Client stream for the MCP server. Defaults to process.stdin. */
  readonly stdin?: Readable;
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

    await run_indexing(root, meta.name, meta.version, cli_options, logger, write_stdout, options.stdin);

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
async function run_indexing(
  root: project_root,
  tool_name: string,
  tool_version: string,
  cli_options: cli_options_type,
  log: logger,
  write_stdout: (text: string) => void,
  stdin: Readable | undefined,
): Promise<void> {
  const store = index_store.open({
    data_dir_path: root.data_dir_path,
    project_root: root.root_path,
    tool_version,
  });

  try {
    const result = await index_project({
      store,
      root_path: root.root_path,
      logger: log,
      force: cli_options.force,
    });
    const counts = store.count();

    log.info(
      `indexed in ${result.duration_ms}ms: ${result.files_added} added, ${result.files_updated} updated, ` +
        `${result.files_removed} removed, ${result.files_unchanged} unchanged`,
    );
    log.info(`index holds ${counts.symbols} symbols and ${counts.relationships} relationships`);
    log.debug(`${result.files_parsed} file(s) needed parsing this run`);
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
    if (cli_options.watch) {
      await watch_until_interrupted(root, store, log);
    } else {
      await serve_until_input_closes(root, tool_name, tool_version, store, log, write_stdout, stdin);
    }
  } finally {
    store.close();
  }
}

/**
 * Serve the MCP protocol on stdio until the client closes the input.
 *
 * A Ctrl+C (or SIGTERM) destroys the input stream so the server loop ends the
 * same way a closed connection would, letting the `finally` above close the
 * database. Signal handlers are only installed when talking to a real stdin;
 * injected streams are test doubles and need no wiring.
 */
async function serve_until_input_closes(
  root: project_root,
  tool_name: string,
  tool_version: string,
  store: index_store,
  log: logger,
  write_stdout: (text: string) => void,
  stdin: Readable | undefined,
): Promise<void> {
  const input = stdin ?? process.stdin;
  log.info('serving MCP on stdio - close the client connection to stop');

  if (stdin === undefined) {
    stop_on_signal(input);
  }

  const reindex = (): Promise<index_project_result> =>
    index_project({ store, root_path: root.root_path, logger: log });

  await run_mcp_server({
    server_name: tool_name,
    server_version: tool_version,
    store,
    root_path: root.root_path,
    reindex,
    input,
    output_write: write_stdout,
  });
}

function stop_on_signal(input: Readable): void {
  const stop = (): void => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    input.destroy();
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

/**
 * Watch until the process is interrupted.
 *
 * Resolving on SIGINT rather than letting the signal kill the process is what
 * allows the `finally` above to close the database. An abandoned handle strands
 * the WAL files and, on Windows, locks the database against the next run.
 */
async function watch_until_interrupted(root: project_root, store: index_store, log: logger): Promise<void> {
  const handle = watch_project({ store, root_path: root.root_path, logger: log });
  log.info('watching for changes - press Ctrl+C to stop');

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      handle.close();
      log.info('stopped watching');
      resolve();
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
