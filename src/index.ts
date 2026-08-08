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
  index_store,
  DATABASE_FILE_NAME,
  type file_stamp,
  type index_counts,
  type open_index_store_options,
} from './store/index_store.js';
export { SCHEMA_VERSION, METADATA_KEYS, TABLE_NAMES } from './store/schema.js';
export {
  index_project,
  analyze_file,
  DEFAULT_WRITE_BATCH_SIZE,
  type index_failure,
  type index_project_options,
  type index_project_result,
} from './indexer/index_project.js';
export {
  resolve_project_graph,
  type resolve_project_graph_options,
  type resolve_project_graph_result,
} from './indexer/resolve_project_graph.js';
export {
  detect_changes,
  normalize_modified_time,
  type change_set,
  type detect_changes_options,
} from './indexer/change_detection.js';
export {
  watch_project,
  DEFAULT_DEBOUNCE_MS,
  type watch_handle,
  type watch_project_options,
} from './indexer/watch_project.js';

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

export {
  find_definition,
  find_references,
  find_callers,
  find_callees,
  type navigation_options,
} from './navigation/navigation.js';
export {
  type callee_hit,
  type caller_hit,
  type find_callees_result,
  type find_callers_result,
  type find_definition_result,
  type find_references_result,
  type reference_hit,
} from './navigation/types.js';

export { get_dependencies, get_dependents, type graph_options } from './graph/graph.js';
export {
  type dependencies_result,
  type dependents_result,
  type dependency_hit,
  type dependent_hit,
} from './graph/types.js';

export {
  get_symbol_context,
  type context_call,
  type context_dependent,
  type context_reference_file,
  type context_symbol_ref,
  type symbol_context_options,
  type symbol_context_result,
} from './context/symbol_context.js';

export {
  extract_symbols,
  type extract_symbols_options,
  type extracted_symbols,
} from './extract/symbol_extractor.js';
export { extract_file, type extract_file_options, type extracted_file } from './extract/extract_file.js';
export { extract_imports, type extract_imports_options } from './extract/import_extractor.js';
export { extract_exports, type extract_exports_options } from './extract/export_extractor.js';
export { extract_references, type extract_references_options } from './extract/reference_extractor.js';
export { extract_calls, type extract_calls_options } from './extract/call_extractor.js';
export {
  build_file_index,
  resolve_module_specifier,
  type file_index,
  type resolve_module_specifier_options,
} from './extract/module_resolution.js';
export { build_signature, MAX_SIGNATURE_LENGTH } from './extract/signature.js';
export { DEFAULT_EXPORT_NAME, read_declaration_name } from './extract/declaration_name.js';

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

export { search_symbols } from './search/search_symbols.js';
export { search_code, DEFAULT_TIME_BUDGET_MS } from './search/search_code.js';
export { build_line_matcher, escape_like, MAX_LINE_LENGTH, MAX_PATTERN_LENGTH } from './search/pattern.js';
export { assert_regex_is_safe, has_nested_quantifier } from './search/regex_safety.js';
export {
  DEFAULT_CODE_LIMIT,
  DEFAULT_MATCHES_PER_FILE,
  DEFAULT_SYMBOL_LIMIT,
  type code_match,
  type enclosing_symbol,
  type match_mode,
  type search_code_options,
  type search_code_result,
  type search_symbols_options,
  type search_symbols_result,
  type symbol_hit,
} from './search/types.js';

export { parse_args } from './cli/parse_args.js';
export { run_cli, BINARY_NAME, type run_cli_options } from './cli/run_cli.js';
export { EXIT_CODE, type cli_options, type exit_code } from './cli/types.js';

export { mcp_server, type mcp_server_options } from './mcp/server.js';
export { run_mcp_server, type run_mcp_server_options } from './mcp/run.js';
export { list_tools, tool_error, type mcp_tool, type tool_context } from './mcp/tools.js';

export {
  apply_patch,
  type apply_patch_edit,
  type apply_patch_options,
  type apply_patch_result,
} from './edit/apply_patch.js';
export {
  replace_symbol,
  type replace_symbol_options,
  type replace_symbol_result,
} from './edit/replace_symbol.js';
export {
  rename_symbol,
  type rename_file_result,
  type rename_symbol_options,
  type rename_symbol_result,
} from './edit/rename_symbol.js';
export {
  build_line_offsets,
  position_to_offset,
  read_current_file,
  resolve_project_path,
  write_project_file,
} from './edit/project_file.js';
