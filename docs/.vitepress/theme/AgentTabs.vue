<script setup>
import { ref } from 'vue';

const activeTab = ref('claude');

const configs = {
  claude: {
    title: 'Claude Code',
    desc: 'Local MCP stdio integration. Adds full AST symbols and cross-file relationships to Claude.',
    steps: [
      {
        title: 'Option A: Quick CLI Add (Recommended)',
        code: 'claude mcp add codebrain -- npx -y @aravindh-arumugam/codebrain-mcp /path/to/project',
        lang: 'bash',
      },
      {
        title: 'Option B: Project .mcp.json',
        code: JSON.stringify({
          mcpServers: {
            codebrain: {
              command: "node",
              args: ["./node_modules/@aravindh-arumugam/codebrain-mcp/dist/cli/main.js", "."],
              type: "stdio"
            }
          }
        }, null, 2),
        lang: 'json',
        note: 'Add "codebrain" to enabledMcpjsonServers in your ~/.claude/settings.json'
      }
    ]
  },
  cursor: {
    title: 'Cursor IDE',
    desc: 'Deep structural codebase navigation for Cursor Composer & Chat agent.',
    steps: [
      {
        title: 'Add to .cursor/mcp.json',
        code: JSON.stringify({
          mcpServers: {
            codebrain: {
              command: "npx",
              args: ["-y", "@aravindh-arumugam/codebrain-mcp", "${workspaceFolder}"]
            }
          }
        }, null, 2),
        lang: 'json',
        note: 'No API keys or cloud tokens required. Works 100% locally on your machine.'
      }
    ]
  },
  windsurf: {
    title: 'Windsurf / Cascade',
    desc: 'Provides Cascade with deterministic call graphs and exact symbol definitions.',
    steps: [
      {
        title: 'Add to ~/.codeium/windsurf/mcp_config.json',
        code: JSON.stringify({
          mcpServers: {
            codebrain: {
              command: "npx",
              args: ["-y", "@aravindh-arumugam/codebrain-mcp", "/absolute/path/to/project"]
            }
          }
        }, null, 2),
        lang: 'json'
      }
    ]
  },
  cline: {
    title: 'Cline / Roo Code (VS Code)',
    desc: 'Empowers Roo Code and Cline with atomic patch edits and lightning-fast symbol search.',
    steps: [
      {
        title: 'Add to Cline MCP Settings (cline_mcp_settings.json)',
        code: JSON.stringify({
          mcpServers: {
            codebrain: {
              command: "npx",
              args: ["-y", "@aravindh-arumugam/codebrain-mcp", "/path/to/project"],
              disabled: false,
              autoApprove: [
                "search_symbols",
                "search_code",
                "get_symbol",
                "get_symbol_context",
                "find_definition",
                "find_references"
              ]
            }
          }
        }, null, 2),
        lang: 'json'
      }
    ]
  }
};
</script>

<template>
  <div class="agent-tabs-container">
    <div class="tabs-header">
      <button
        v-for="(cfg, key) in configs"
        :key="key"
        class="tab-btn"
        :class="{ active: activeTab === key }"
        @click="activeTab = key"
      >
        <span class="tab-dot"></span>
        {{ cfg.title }}
      </button>
    </div>

    <div class="tab-body">
      <div class="tab-meta">
        <h3 class="tab-title">{{ configs[activeTab].title }} Setup</h3>
        <p class="tab-desc">{{ configs[activeTab].desc }}</p>
      </div>

      <div v-for="(step, idx) in configs[activeTab].steps" :key="idx" class="step-card">
        <div class="step-header">
          <span class="step-num">{{ idx + 1 }}</span>
          <span class="step-title">{{ step.title }}</span>
        </div>
        <pre class="step-code"><code>{{ step.code }}</code></pre>
        <div v-if="step.note" class="step-note">
          <span class="note-icon">💡</span> {{ step.note }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-tabs-container {
  margin: 1.5rem 0 2rem;
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  overflow: hidden;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}

.tabs-header {
  display: flex;
  overflow-x: auto;
  background: var(--vp-c-bg-alt);
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 6px 8px 0;
  gap: 6px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px 8px 0 0;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  color: var(--vp-c-text-1);
}

.tab-btn.active {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-bg-soft);
  margin-bottom: -1px;
}

.tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #64748b;
  transition: background 0.2s;
}

.tab-btn.active .tab-dot {
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 8px var(--vp-c-brand-1);
}

.tab-body {
  padding: 20px;
}

.tab-meta {
  margin-bottom: 16px;
}

.tab-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.tab-desc {
  margin: 0;
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
}

.step-card {
  margin-top: 14px;
  padding: 14px;
  background: var(--vp-c-bg-alt);
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
}

.step-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 0.8rem;
  font-weight: 700;
}

.step-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.step-code {
  margin: 0;
  padding: 12px;
  background: var(--vp-c-bg);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  overflow-x: auto;
  color: var(--vp-c-text-1);
}

.step-note {
  margin-top: 8px;
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
