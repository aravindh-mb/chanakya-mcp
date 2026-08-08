/**
 * Extracting `calls` edges from a parsed file.
 *
 * Every call expression becomes an edge from the innermost enclosing symbol
 * (or the file, when the call sits at the top level) to the name written in
 * the callee. Same-file targets resolve here against the file's own symbols;
 * cross-file targets are left unresolved and joined later by the graph
 * resolution pass, which follows imports.
 *
 * Targets that cannot be resolved honestly stay unresolved: a call is never
 * pointed at a guessed symbol.
 */

import type { parsed_file, syntax_node } from '../parser/types.js';
import { build_relationship_id, type relationship } from '../model/relationship.js';
import type { code_symbol } from '../model/symbol.js';
import {
  build_scope_index,
  build_start_index,
  read_chain,
  resolve_member_chain,
  scope_tracker,
} from './scope_resolver.js';

export interface extract_calls_options {
  readonly parsed: parsed_file;
  /** POSIX path relative to the project root. */
  readonly relative_path: string;
  /** The file's own symbols, for same-file resolution. */
  readonly symbols: readonly code_symbol[];
}

export function extract_calls(options: extract_calls_options): readonly relationship[] {
  const { parsed, relative_path, symbols } = options;
  const scope = build_scope_index(symbols);
  const tracker = new scope_tracker(build_start_index(symbols));

  const edges: relationship[] = [];
  const used_ids = new Set<string>();

  for (const node of parsed.root.walk()) {
    // Advance on every node so the enclosing-symbol stack is accurate by the
    // time a call expression is reached.
    const { enclosing_id } = tracker.advance(node);

    if (node.type !== 'call_expression') {
      continue;
    }

    const callee = node.child_by_field('function');
    if (callee === undefined) {
      continue;
    }
    // Dynamic `import(...)` and the CommonJS `require` are recorded by the
    // import extractor, not as calls to unknown functions.
    if (callee.type === 'import' || (callee.type === 'identifier' && callee.text === 'require')) {
      continue;
    }

    const chain = read_chain(callee);
    const to_name = chain === undefined ? callee.text : chain.join('.');
    const to_id = chain === undefined ? undefined : resolve_member_chain(scope, chain, enclosing_id)?.id;

    edges.push(
      build_call_edge(relative_path, node, enclosing_id ?? relative_path, to_name, to_id, used_ids),
    );
  }

  return edges;
}

function build_call_edge(
  file_path: string,
  call: syntax_node,
  from_id: string,
  to_name: string,
  to_id: string | undefined,
  used_ids: Set<string>,
): relationship {
  const line = call.range.start.line;

  const base = build_relationship_id({
    kind: 'calls',
    from_id,
    to_name,
    file_path,
    line,
  });

  let id = base;
  let disambiguator = 2;
  while (used_ids.has(id)) {
    id = build_relationship_id({ kind: 'calls', from_id, to_name, file_path, line, disambiguator });
    disambiguator += 1;
  }
  used_ids.add(id);

  return {
    id,
    kind: 'calls',
    from_id,
    to_id,
    to_name,
    confidence: 'certain',
    file_path,
    line,
  };
}
