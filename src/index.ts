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

export { is_path_inside, to_posix_path, to_relative_posix_path } from './core/paths.js';

export { scan_project, walk_project } from './scanner/file_scanner.js';
export {
  detect_language,
  get_extension,
  is_supported_file,
  SUPPORTED_EXTENSIONS,
  type language_id,
} from './scanner/language.js';
export {
  DEFAULT_IGNORED_DIRECTORIES,
  DEFAULT_IGNORE_PATTERNS,
  GITIGNORE_FILE_NAME,
} from './scanner/ignore_rules.js';
export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  type scan_event,
  type scan_options,
  type scan_result,
  type scan_stats,
  type scanned_file,
  type skip_reason,
  type skipped_entry,
} from './scanner/types.js';

export { hash_content } from './core/hash.js';

export {
  build_symbol_id,
  is_symbol_kind,
  SYMBOL_KINDS,
  type code_symbol,
  type export_kind,
  type symbol_kind,
  type symbol_location,
} from './model/symbol.js';
export {
  build_relationship_id,
  is_relationship_kind,
  is_resolved,
  RELATIONSHIP_KINDS,
  RELATIONSHIP_CONFIDENCES,
  type relationship,
  type relationship_confidence,
  type relationship_kind,
} from './model/relationship.js';
export {
  is_internal_specifier,
  type code_export,
  type code_import,
  type code_reference,
  type export_kind_detail,
  type import_kind,
} from './model/module_graph.js';
export { create_empty_analysis, type code_file, type file_analysis } from './model/file.js';

export { parse_file, parse_source } from './parser/parse_file.js';
export { get_grammar, get_parser, reset_parser_cache } from './parser/language_registry.js';
export {
  DEFAULT_MAX_PARSE_ERRORS,
  DEFAULT_MAX_SOURCE_BYTES,
  type parse_error,
  type parse_error_kind,
  type parse_file_options,
  type parse_source_options,
  type parsed_file,
  type source_position,
  type source_range,
  type syntax_node,
} from './parser/types.js';

export { parse_args } from './cli/parse_args.js';
export { run_cli, BINARY_NAME, type run_cli_options } from './cli/run_cli.js';
export { EXIT_CODE, type cli_options, type exit_code } from './cli/types.js';
