/**
 * Public library surface of @code-intelligence/mcp.
 *
 * The package is primarily consumed as a CLI / MCP server, but the internals
 * are exported so they can be embedded in other tooling.
 */

export {
  code_intelligence_error,
  is_code_intelligence_error,
  describe_unknown_error,
  stringify_safely,
  type error_code,
  type error_options,
} from './core/errors.js';

export { create_logger, type logger, type logger_options, type log_level } from './core/logger.js';

export { read_package_meta, type package_meta } from './core/package_meta.js';

export {
  resolve_project_root,
  DATA_DIR_NAME,
  type project_root,
  type resolve_project_root_options,
} from './core/project_root.js';

export { parse_args } from './cli/parse_args.js';
export { run_cli, BINARY_NAME, type run_cli_options } from './cli/run_cli.js';
export { EXIT_CODE, type cli_options, type exit_code } from './cli/types.js';
