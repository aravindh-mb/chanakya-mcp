/**
 * The one entry point for turning a parsed file into every row the store can
 * hold: symbols, containment and call edges, imports, exports and references.
 *
 * The sub-extractors run in dependency order — calls, exports and references
 * need the file's symbols to resolve against — and their outputs are merged
 * into a single result so callers can store them in one shot.
 */

import type { parsed_file } from '../parser/types.js';
import type { code_symbol } from '../model/symbol.js';
import type { relationship } from '../model/relationship.js';
import type { code_export, code_import, code_reference } from '../model/module_graph.js';
import { extract_calls } from './call_extractor.js';
import { extract_exports } from './export_extractor.js';
import { extract_imports } from './import_extractor.js';
import { extract_references } from './reference_extractor.js';
import { extract_symbols } from './symbol_extractor.js';
import type { file_index } from './module_resolution.js';

export interface extract_file_options {
  readonly parsed: parsed_file;
  /** POSIX path relative to the project root. */
  readonly relative_path: string;
  /**
   * Files the current scan knows about, for resolving import specifiers. The
   * graph resolution pass can fill in whatever is missed later.
   */
  readonly files?: file_index;
}

export interface extracted_file {
  readonly relative_path: string;
  readonly language: parsed_file['language'];
  readonly symbols: readonly code_symbol[];
  /** `contains` edges from the symbol extractor plus `calls` edges. */
  readonly relationships: readonly relationship[];
  readonly imports: readonly code_import[];
  readonly exports: readonly code_export[];
  readonly references: readonly code_reference[];
}

export function extract_file(options: extract_file_options): extracted_file {
  const { parsed, relative_path } = options;

  const { symbols, relationships: containment } = extract_symbols({ parsed, relative_path });
  const calls = extract_calls({ parsed, relative_path, symbols });

  return {
    relative_path,
    language: parsed.language,
    symbols,
    relationships: [...containment, ...calls],
    imports: extract_imports(
      options.files === undefined
        ? { parsed, relative_path }
        : { parsed, relative_path, files: options.files },
    ),
    exports: extract_exports({ parsed, relative_path, symbols }),
    references: extract_references({ parsed, relative_path, symbols }),
  };
}
