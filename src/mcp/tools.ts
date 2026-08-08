/**
 * The MCP tool surface.
 *
 * Ten read-only tools wrapping the search, navigation and graph layers, plus
 * three edit tools that write files and reindex. Every tool validates its
 * arguments with a zod schema, and the same schema is serialised to JSON
 * Schema so the client can present it to the model. Results are JSON text:
 * locations and names, never file contents.
 *
 * A tool that runs into a business problem (a symbol id that does not exist,
 * a file that is not indexed, a patch that does not apply) raises
 * `tool_error`; the server reports it as a failed tool result rather than a
 * protocol error, which is what lets the model read the reason and recover.
 */

import { z } from 'zod';
import { get_symbol_context } from '../context/symbol_context.js';
import { apply_patch, type apply_patch_edit } from '../edit/apply_patch.js';
import { rename_symbol } from '../edit/rename_symbol.js';
import { replace_symbol } from '../edit/replace_symbol.js';
import { get_dependencies, get_dependents } from '../graph/graph.js';
import type { index_project_result } from '../indexer/index_project.js';
import type { code_symbol, symbol_kind } from '../model/symbol.js';
import { find_callees, find_callers, find_definition, find_references } from '../navigation/navigation.js';
import type { language_id } from '../scanner/language.js';
import { search_code } from '../search/search_code.js';
import type { search_code_options } from '../search/types.js';
import { search_symbols } from '../search/search_symbols.js';
import type { index_store } from '../store/index_store.js';

export { tool_error } from './errors.js';
import { tool_error } from './errors.js';

/**
 * Everything a tool needs to do its job. Read-only tools use `store`; edit
 * tools also need the project root to address files and a `reindex` step to
 * bring the index in line with the files they just changed.
 */
export interface tool_context {
  readonly store: index_store;
  readonly root_path: string;
  readonly reindex: () => Promise<index_project_result>;
}

export interface mcp_tool {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType;
  readonly call: (ctx: tool_context, args: unknown) => unknown | Promise<unknown>;
}

const symbol_kind_schema = z.enum([
  'function',
  'class',
  'method',
  'interface',
  'type',
  'variable',
  'constant',
  'enum',
  'module',
] satisfies readonly symbol_kind[]);

const language_schema = z.enum(['javascript', 'jsx', 'typescript', 'tsx'] satisfies readonly language_id[]);

const non_empty_string = z.string().min(1);

function search_symbols_tool(): mcp_tool {
  return {
    name: 'search_symbols',
    description:
      'Find symbols by name. Returns id, kind, location and signature for each match, ranked exact then prefix then substring.',
    schema: z.object({
      query: non_empty_string,
      match: z.enum(['exact', 'prefix', 'substring']).optional(),
      case_sensitive: z.boolean().optional(),
      kinds: z.array(symbol_kind_schema).optional(),
      languages: z.array(language_schema).optional(),
      path_contains: z.string().optional(),
      exported_only: z.boolean().optional(),
      exclude_ambient: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    call: (ctx, args) => {
      const options = args as { query: string } & Record<string, unknown>;
      const result = search_symbols(ctx.store, options);
      return {
        symbols: result.hits.map((hit) => ({
          id: hit.symbol.id,
          name: hit.symbol.name,
          kind: hit.symbol.kind,
          file_path: hit.symbol.file_path,
          start_line: hit.symbol.start_line,
          start_column: hit.symbol.start_column,
          end_line: hit.symbol.end_line,
          end_column: hit.symbol.end_column,
          signature: hit.symbol.signature,
          export_kind: hit.symbol.export_kind,
        })),
        truncated: result.truncated,
      };
    },
  };
}

function search_code_tool(): mcp_tool {
  return {
    name: 'search_code',
    description:
      'Search file contents for literal text or a regular expression. Every match is annotated with the symbol that encloses it.',
    schema: z.object({
      query: non_empty_string,
      is_regex: z.boolean().optional(),
      case_sensitive: z.boolean().optional(),
      languages: z.array(language_schema).optional(),
      path_contains: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      max_matches_per_file: z.number().int().min(1).optional(),
      context_lines: z.number().int().min(0).max(10).optional(),
      time_budget_ms: z.number().int().positive().optional(),
    }),
    call: async (ctx, args) => search_code(ctx.store, args as unknown as search_code_options),
  };
}

function get_symbol_tool(): mcp_tool {
  return {
    name: 'get_symbol',
    description: 'Return the full row for a symbol id: kind, location, parent, signature, export kind.',
    schema: z.object({
      id: non_empty_string,
    }),
    call: (ctx, args) => {
      const symbol = ctx.store.get_symbol((args as { id: string }).id);
      if (symbol === undefined) {
        throw new tool_error(`no symbol with id '${(args as { id: string }).id}'`);
      }
      return { symbol };
    },
  };
}

function get_file_structure_tool(): mcp_tool {
  return {
    name: 'get_file_structure',
    description:
      'Return the symbols of a file as a tree: top-level declarations with their members nested beneath them.',
    schema: z.object({
      path: non_empty_string,
    }),
    call: (ctx, args) => file_structure(ctx.store, (args as { path: string }).path),
  };
}

function find_definition_tool(): mcp_tool {
  return {
    name: 'find_definition',
    description: 'Where a symbol is declared: its file, lines and signature, resolved by symbol id.',
    schema: z.object({
      id: non_empty_string,
    }),
    call: (ctx, args) => {
      const result = find_definition({ store: ctx.store }, (args as { id: string }).id);
      if (result.symbol === undefined) {
        throw new tool_error(`no symbol with id '${(args as { id: string }).id}'`);
      }
      return result;
    },
  };
}

function find_references_tool(): mcp_tool {
  return {
    name: 'find_references',
    description:
      'Every indexed occurrence of a symbol, definition first: where it is declared and where it is used, with the enclosing symbol of each use.',
    schema: z.object({
      id: non_empty_string,
    }),
    call: (ctx, args) => find_references({ store: ctx.store }, (args as { id: string }).id),
  };
}

function get_callers_tool(): mcp_tool {
  return {
    name: 'get_callers',
    description:
      'The symbols whose bodies call a symbol, with where each call happens and how confidently it resolved.',
    schema: z.object({
      id: non_empty_string,
    }),
    call: (ctx, args) => find_callers({ store: ctx.store }, (args as { id: string }).id),
  };
}

function get_callees_tool(): mcp_tool {
  return {
    name: 'get_callees',
    description:
      'The symbols a symbol calls, with where each call happens. Unresolved calls are named honestly.',
    schema: z.object({
      id: non_empty_string,
    }),
    call: (ctx, args) => find_callees({ store: ctx.store }, (args as { id: string }).id),
  };
}

function get_dependencies_tool(): mcp_tool {
  return {
    name: 'get_dependencies',
    description:
      'The modules a file imports, grouped by target: internal files by path, packages by specifier, plus the names each import binds.',
    schema: z.object({
      path: non_empty_string,
    }),
    call: (ctx, args) => get_dependencies({ store: ctx.store }, (args as { path: string }).path),
  };
}

function get_dependents_tool(): mcp_tool {
  return {
    name: 'get_dependents',
    description: 'The files that import a module, and the barrels that re-export from it.',
    schema: z.object({
      path: non_empty_string,
    }),
    call: (ctx, args) => get_dependents({ store: ctx.store }, (args as { path: string }).path),
  };
}

function get_symbol_context_tool(): mcp_tool {
  return {
    name: 'get_symbol_context',
    description:
      'A symbol\u2019s working context in one call: what it is, what contains it and what it contains, how heavily it is used and where, who calls it, what it calls, and what its file imports and is imported by. Every list is capped; totals say how much was left out.',
    schema: z.object({
      id: non_empty_string,
    }),
    call: (ctx, args) => get_symbol_context({ store: ctx.store }, (args as { id: string }).id),
  };
}

function apply_patch_tool(): mcp_tool {
  return {
    name: 'apply_patch',
    description:
      'Edit a file with exact text replacements. Each edit replaces the first occurrence of old_text in the CURRENT file content with new_text, applied in order; a non-matching or ambiguous old_text refuses the whole call, so a patch cannot silently corrupt. The index refreshes automatically.',
    schema: z.object({
      path: non_empty_string,
      edits: z.array(
        z.object({
          old_text: non_empty_string,
          new_text: z.string(),
        }),
      ),
    }),
    call: async (ctx, args) => {
      const { path, edits } = args as { path: string; edits: apply_patch_edit[] };
      return apply_patch({ store: ctx.store, root_path: ctx.root_path, reindex: ctx.reindex, path, edits });
    },
  };
}

function replace_symbol_tool(): mcp_tool {
  return {
    name: 'replace_symbol',
    description:
      'Replace a symbol\u2019s whole declaration with new_source, spliced in at the exact source range the index recorded. Supply the complete replacement text for the declaration.',
    schema: z.object({
      id: non_empty_string,
      new_source: z.string(),
    }),
    call: async (ctx, args) => {
      const { id, new_source } = args as { id: string; new_source: string };
      return replace_symbol({
        store: ctx.store,
        root_path: ctx.root_path,
        reindex: ctx.reindex,
        id,
        new_source,
      });
    },
  };
}

function rename_symbol_tool(): mcp_tool {
  return {
    name: 'rename_symbol',
    description:
      'Rename a symbol everywhere the index resolved it: its declaration and every reference, across files. Uses only the new name; a file that drifted from the index refuses the whole rename. Occurrences the index could not resolve are left alone.',
    schema: z.object({
      id: non_empty_string,
      new_name: non_empty_string,
    }),
    call: async (ctx, args) => {
      const { id, new_name } = args as { id: string; new_name: string };
      return rename_symbol({
        store: ctx.store,
        root_path: ctx.root_path,
        reindex: ctx.reindex,
        id,
        new_name,
      });
    },
  };
}

export function list_tools(): readonly mcp_tool[] {
  return [
    search_symbols_tool(),
    search_code_tool(),
    get_symbol_tool(),
    get_file_structure_tool(),
    find_definition_tool(),
    find_references_tool(),
    get_callers_tool(),
    get_callees_tool(),
    get_dependencies_tool(),
    get_dependents_tool(),
    get_symbol_context_tool(),
    apply_patch_tool(),
    replace_symbol_tool(),
    rename_symbol_tool(),
  ];
}

interface structure_node {
  readonly symbol: code_symbol;
  readonly children: structure_node[];
}

function file_structure(
  store: index_store,
  file_path: string,
): {
  readonly file: { file_path: string; language: string; size: number } | undefined;
  readonly symbols: unknown[];
} {
  const symbols = store.get_symbols_in_file(file_path);
  const file = store.get_file(file_path);
  if (symbols.length === 0 && file === undefined) {
    throw new tool_error(`no indexed file at '${file_path}'`);
  }

  const nodes = new Map<string, structure_node>();
  for (const symbol of symbols) {
    nodes.set(symbol.id, { symbol, children: [] });
  }

  const roots: structure_node[] = [];
  for (const symbol of symbols) {
    const node = nodes.get(symbol.id)!;
    const parent = symbol.parent_id === undefined ? undefined : nodes.get(symbol.parent_id);
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  return {
    file:
      file === undefined
        ? undefined
        : { file_path: file.file_path, language: file.language, size: file.size },
    symbols: roots.map(serialize_node),
  };
}

function serialize_node(node: structure_node): unknown {
  const { symbol } = node;
  return {
    id: symbol.id,
    name: symbol.name,
    kind: symbol.kind,
    start_line: symbol.start_line,
    start_column: symbol.start_column,
    end_line: symbol.end_line,
    end_column: symbol.end_column,
    signature: symbol.signature,
    export_kind: symbol.export_kind,
    children: node.children.map(serialize_node),
  };
}
