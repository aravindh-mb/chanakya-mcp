<script setup>
import { ref } from 'vue';

const activeCategory = ref('all');

const tools = [
  {
    name: 'search_symbols',
    category: 'search',
    type: 'Read-only',
    desc: 'Tri-tier ranked symbol search (exact -> prefix -> substring) with kind, path, and language filters.',
    args: [
      { name: 'query', type: 'string', req: true, desc: 'Symbol name or search query' },
      { name: 'match', type: '"exact" | "prefix" | "substring"', req: false, desc: 'Match strategy ranking' },
      { name: 'kinds', type: 'string[]', req: false, desc: 'Filter by function, class, interface, etc.' },
      { name: 'exported_only', type: 'boolean', req: false, desc: 'Only return public exports' }
    ],
    example: `call_tool("search_symbols", {\n  query: "UserService",\n  match: "exact",\n  exported_only: true\n})`
  },
  {
    name: 'search_code',
    category: 'search',
    type: 'Read-only',
    desc: 'Full-text code search annotated with the innermost enclosing AST symbol for every match. Worker-thread ReDoS safe.',
    args: [
      { name: 'query', type: 'string', req: true, desc: 'Text or regular expression' },
      { name: 'is_regex', type: 'boolean', req: false, desc: 'Treat query as regex' },
      { name: 'time_budget_ms', type: 'number', req: false, desc: 'Execution timeout cap (default: 500ms)' }
    ],
    example: `call_tool("search_code", {\n  query: "jwt\\.verify",\n  is_regex: true,\n  context_lines: 2\n})`
  },
  {
    name: 'get_symbol',
    category: 'navigation',
    type: 'Read-only',
    desc: 'Returns the full indexed metadata for a symbol: kind, signature, container, and export status.',
    args: [
      { name: 'id', type: 'string', req: true, desc: 'Canonical symbol ID (e.g., src/user.ts#class:UserService)' }
    ],
    example: `call_tool("get_symbol", {\n  id: "src/user.ts#class:UserService"\n})`
  },
  {
    name: 'get_symbol_context',
    category: 'context',
    type: 'Read-only',
    desc: 'The ultimate agent context query. Returns symbol details, members, callers, callees, references, and module neighborhood.',
    args: [
      { name: 'id', type: 'string', req: true, desc: 'Target symbol identifier' }
    ],
    example: `call_tool("get_symbol_context", {\n  id: "src/user.ts#method:UserService.create_user"\n})`
  },
  {
    name: 'find_definition',
    category: 'navigation',
    type: 'Read-only',
    desc: 'Locates exactly where a symbol is declared: file path, 1-based start/end line, and clean signature.',
    args: [
      { name: 'id', type: 'string', req: true, desc: 'Symbol identifier' }
    ],
    example: `call_tool("find_definition", {\n  id: "src/auth.ts#function:verify_token"\n})`
  },
  {
    name: 'find_references',
    category: 'navigation',
    type: 'Read-only',
    desc: 'Finds every semantic occurrence of a symbol across the entire repository with enclosing symbol annotations.',
    args: [
      { name: 'id', type: 'string', req: true, desc: 'Symbol identifier' }
    ],
    example: `call_tool("find_references", {\n  id: "packages/shared/types.ts#interface:UserConfig"\n})`
  },
  {
    name: 'get_callers',
    category: 'navigation',
    type: 'Read-only',
    desc: 'Lists all functions/methods that call this symbol, along with syntactic vs resolved call confidence.',
    args: [
      { name: 'id', type: 'string', req: true, desc: 'Callable symbol identifier' }
    ],
    example: `call_tool("get_callers", {\n  id: "src/db.ts#function:connect_database"\n})`
  },
  {
    name: 'get_callees',
    category: 'navigation',
    type: 'Read-only',
    desc: 'Lists all functions, methods, and external constructors invoked from inside this symbol body.',
    args: [
      { name: 'id', type: 'string', req: true, desc: 'Symbol identifier' }
    ],
    example: `call_tool("get_callees", {\n  id: "src/routes.ts#function:handle_checkout"\n})`
  },
  {
    name: 'get_file_structure',
    category: 'navigation',
    type: 'Read-only',
    desc: 'Returns a tree of symbols declared in a file: classes, interfaces, functions, and nested member declarations.',
    args: [
      { name: 'path', type: 'string', req: true, desc: 'Project-relative file path' }
    ],
    example: `call_tool("get_file_structure", {\n  path: "src/services/billing.ts"\n})`
  },
  {
    name: 'get_dependencies',
    category: 'graph',
    type: 'Read-only',
    desc: 'Returns all internal files and external npm packages that a file imports.',
    args: [
      { name: 'path', type: 'string', req: true, desc: 'Project-relative file path' }
    ],
    example: `call_tool("get_dependencies", {\n  path: "src/server.ts"\n})`
  },
  {
    name: 'get_dependents',
    category: 'graph',
    type: 'Read-only',
    desc: 'Returns all files and re-exporting barrel files that import or depend on this file.',
    args: [
      { name: 'path', type: 'string', req: true, desc: 'Project-relative file path' }
    ],
    example: `call_tool("get_dependents", {\n  path: "packages/shared/constants.ts"\n})`
  },
  {
    name: 'apply_patch',
    category: 'edit',
    type: 'Safe Edit',
    desc: 'Applies exact text replacements in sequence. Refuses stale files, missing text, or ambiguous multiple matches.',
    args: [
      { name: 'path', type: 'string', req: true, desc: 'Project-relative file path' },
      { name: 'edits', type: '{ old_text: string, new_text: string }[]', req: true, desc: 'Exact ordered replacements' }
    ],
    example: `call_tool("apply_patch", {\n  path: "src/config.ts",\n  edits: [{\n    old_text: "port: 3000,",\n    new_text: "port: process.env.PORT || 3000,"\n  }]\n})`
  },
  {
    name: 'replace_symbol',
    category: 'edit',
    type: 'Safe Edit',
    desc: 'Replaces a symbol declaration directly using its index-recorded byte range. Eliminates fuzzy matching drift.',
    args: [
      { name: 'id', type: 'string', req: true, desc: 'Target symbol identifier' },
      { name: 'new_source', type: 'string', req: true, desc: 'Complete replacement code for the declaration' }
    ],
    example: `call_tool("replace_symbol", {\n  id: "src/utils.ts#function:format_date",\n  new_source: "export function format_date(d: Date): string { return d.toISOString(); }"\n})`
  },
  {
    name: 'rename_symbol',
    category: 'edit',
    type: 'Safe Edit',
    desc: 'Renames a symbol across the entire codebase: declaration, all references, imports, and re-export barrels.',
    args: [
      { name: 'id', type: 'string', req: true, desc: 'Target symbol identifier' },
      { name: 'new_name', type: 'string', req: true, desc: 'New identifier name' }
    ],
    example: `call_tool("rename_symbol", {\n  id: "src/models/user.ts#interface:UserEntity",\n  new_name: "UserProfile"\n})`
  }
];

function filteredTools() {
  if (activeCategory.value === 'all') return tools;
  return tools.filter(t => t.category === activeCategory.value);
}
</script>

<template>
  <div class="tool-playground">
    <div class="tool-filters">
      <button
        class="filter-chip"
        :class="{ active: activeCategory === 'all' }"
        @click="activeCategory = 'all'"
      >
        All (14)
      </button>
      <button
        class="filter-chip"
        :class="{ active: activeCategory === 'search' }"
        @click="activeCategory = 'search'"
      >
        Search (2)
      </button>
      <button
        class="filter-chip"
        :class="{ active: activeCategory === 'navigation' }"
        @click="activeCategory = 'navigation'"
      >
        Navigation (5)
      </button>
      <button
        class="filter-chip"
        :class="{ active: activeCategory === 'context' }"
        @click="activeCategory = 'context'"
      >
        Context (1)
      </button>
      <button
        class="filter-chip"
        :class="{ active: activeCategory === 'graph' }"
        @click="activeCategory = 'graph'"
      >
        Module Graph (2)
      </button>
      <button
        class="filter-chip"
        :class="{ active: activeCategory === 'edit' }"
        @click="activeCategory = 'edit'"
      >
        Safe Edits (3)
      </button>
    </div>

    <div class="tool-grid">
      <div v-for="t in filteredTools()" :key="t.name" class="tool-card">
        <div class="tool-top">
          <span class="tool-name">{{ t.name }}</span>
          <span
            class="tool-type-badge"
            :class="t.type === 'Safe Edit' ? 'badge-amber' : 'badge-blue'"
          >
            {{ t.type }}
          </span>
        </div>
        <p class="tool-desc">{{ t.desc }}</p>

        <div class="tool-params">
          <div class="params-label">Parameters (JSON Schema validated):</div>
          <div v-for="arg in t.args" :key="arg.name" class="param-row">
            <span class="param-name">{{ arg.name }}<span v-if="arg.req" class="req-star">*</span></span>
            <span class="param-type">{{ arg.type }}</span>
            <span class="param-desc">{{ arg.desc }}</span>
          </div>
        </div>

        <div class="tool-example">
          <div class="example-label">Example Agent Tool Call:</div>
          <pre class="example-code"><code>{{ t.example }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-playground {
  margin: 1.5rem 0 2.5rem;
}

.tool-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.filter-chip {
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 0.82rem;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-chip:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

.filter-chip.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.tool-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.tool-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  padding: 18px;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.tool-card:hover {
  border-color: var(--vp-c-brand-1);
}

.tool-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.tool-name {
  font-family: var(--vp-font-family-mono);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.tool-type-badge {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
  text-transform: uppercase;
}

.tool-desc {
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
  margin: 0 0 14px;
  line-height: 1.5;
}

.params-label, .example-label {
  font-size: 0.76rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  margin-bottom: 6px;
}

.tool-params {
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.param-row {
  display: grid;
  grid-template-columns: 130px 180px 1fr;
  gap: 8px;
  font-size: 0.8rem;
  padding: 4px 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.param-row:last-child {
  border-bottom: none;
}

.param-name {
  font-family: var(--vp-font-family-mono);
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.req-star {
  color: #ef4444;
  margin-left: 2px;
}

.param-type {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.param-desc {
  color: var(--vp-c-text-2);
}

.example-code {
  margin: 0;
  padding: 10px 12px;
  background: var(--vp-c-bg);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: var(--vp-c-text-1);
  overflow-x: auto;
}

@media (max-width: 768px) {
  .param-row {
    grid-template-columns: 1fr;
    gap: 2px;
    padding: 6px 0;
  }
}
</style>
