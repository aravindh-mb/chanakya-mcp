<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

// Active Scenario
const activeScenario = ref('get_symbol_context');

const scenarios = [
  {
    id: 'get_symbol_context',
    label: 'get_symbol_context',
    badge: '360° Context',
    description: 'Retrieve full symbol declaration, callers, callees, references, and module neighborhood.'
  },
  {
    id: 'find_definition',
    label: 'find_definition',
    badge: 'Navigation',
    description: 'Instant AST line/column coordinate lookup with exact signature in ~0.02ms.'
  },
  {
    id: 'get_callers',
    label: 'get_callers',
    badge: 'Call Graph',
    description: 'Traverse relational caller edges with syntactic vs resolved confidence.'
  },
  {
    id: 'search_symbols',
    label: 'search_symbols',
    badge: 'Tri-Tier Search',
    description: 'Ranked B-Tree lookup (exact -> prefix -> substring) across all indexed symbols.'
  }
];

// Steps definition
const steps = [
  {
    id: 1,
    title: 'AI Tool Call',
    short: 'Tool Call',
    icon: '⚡',
    subtitle: 'JSON-RPC 2.0 over Stdio (stdin)',
    tag: 'Protocol Layer'
  },
  {
    id: 2,
    title: 'Scan & AST Parse',
    short: 'AST Parse',
    icon: '🌲',
    subtitle: 'Tree-Sitter Concrete Syntax Tree',
    tag: 'Compiler Engine'
  },
  {
    id: 3,
    title: 'Extract Symbols & Graph',
    short: 'Extraction',
    icon: '🔍',
    subtitle: 'Entities, Scopes & Call Edges',
    tag: 'Extraction Pipeline'
  },
  {
    id: 4,
    title: 'Relational SQLite Store',
    short: 'SQLite DB',
    icon: '💾',
    subtitle: '8 Tables, String Interning & B-Trees',
    tag: 'Storage Engine'
  },
  {
    id: 5,
    title: 'Sub-ms Retrieval & Response',
    short: '360° Result',
    icon: '🚀',
    subtitle: 'Context Synthesis & Stdio (stdout)',
    tag: 'Delivery Layer'
  }
];

const currentStep = ref(1);
const isPlaying = ref(true);
const playbackSpeed = ref(1); // 1x, 1.5x, 2x
const activeSqlTable = ref('symbols');
let timer = null;

const stepDuration = computed(() => {
  return Math.round(3800 / playbackSpeed.value);
});

function goToStep(stepId) {
  currentStep.value = stepId;
}

function nextStep() {
  if (currentStep.value < 5) {
    currentStep.value++;
  } else {
    currentStep.value = 1;
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--;
  } else {
    currentStep.value = 5;
  }
}

function togglePlay() {
  isPlaying.value = !isPlaying.value;
  if (isPlaying.value) {
    startAutoPlay();
  } else {
    stopAutoPlay();
  }
}

function setSpeed(speed) {
  playbackSpeed.value = speed;
  if (isPlaying.value) {
    stopAutoPlay();
    startAutoPlay();
  }
}

function startAutoPlay() {
  stopAutoPlay();
  timer = setInterval(() => {
    nextStep();
  }, stepDuration.value);
}

function stopAutoPlay() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

onMounted(() => {
  startAutoPlay();
});

onUnmounted(() => {
  stopAutoPlay();
});

// Scenario specific data
const scenarioData = computed(() => {
  switch (activeScenario.value) {
    case 'find_definition':
      return {
        toolName: 'find_definition',
        targetId: 'src/auth/service.ts#function:verify_token',
        args: { id: 'src/auth/service.ts#function:verify_token' },
        reasoning: 'Need the exact definition file and start/end coordinates for `verify_token` without reading whole files.',
        astTarget: 'function_declaration: verify_token (Lines 82-105)',
        extractedEntity: {
          name: 'verify_token',
          kind: 'function',
          file: 'src/auth/service.ts',
          lines: '82-105',
          signature: 'export function verify_token(token: string): TokenPayload'
        },
        sqlQuery: 'SELECT s.*, f.file_path FROM symbols s JOIN files f ON s.file_id = f.file_id WHERE s.id = ? LIMIT 1;',
        queryLatency: '0.02 ms',
        responseTokens: '95 tokens (vs 3,200 tokens naive read)',
        savings: '97% Token Savings'
      };
    case 'get_callers':
      return {
        toolName: 'get_callers',
        targetId: 'src/db/pool.ts#function:query_database',
        args: { id: 'src/db/pool.ts#function:query_database' },
        reasoning: 'Need to find all functions calling `query_database` to analyze connection pooling impact before refactoring.',
        astTarget: 'call_expression: query_database (found across 4 files)',
        extractedEntity: {
          name: 'query_database',
          kind: 'function',
          file: 'src/db/pool.ts',
          lines: '14-38',
          signature: 'export async function query_database<T>(sql: string, params?: unknown[]): Promise<T[]>'
        },
        sqlQuery: 'SELECT r.*, s.name as caller_name, f.file_path FROM relationships r JOIN symbols s ON r.from_key = s.key JOIN files f ON r.file_id = f.file_id WHERE r.to_name = "query_database" AND r.kind = "calls";',
        queryLatency: '0.04 ms',
        responseTokens: '140 tokens (vs 4,100 tokens naive read)',
        savings: '96% Token Savings'
      };
    case 'search_symbols':
      return {
        toolName: 'search_symbols',
        targetId: 'UserService',
        args: { query: 'UserService', match: 'exact', exported_only: true },
        reasoning: 'Need to find all exported declarations of `UserService` across the repository with zero false positives.',
        astTarget: 'class_declaration: UserService (Lines 24-118)',
        extractedEntity: {
          name: 'UserService',
          kind: 'class',
          file: 'src/auth/service.ts',
          lines: '24-118',
          signature: 'export class UserService implements IAuthService'
        },
        sqlQuery: 'SELECT s.*, f.file_path FROM symbols s JOIN files f ON s.file_id = f.file_id WHERE s.name = "UserService" AND s.export_kind != "none" ORDER BY s.kind LIMIT 20;',
        queryLatency: '0.03 ms',
        responseTokens: '110 tokens (vs 2,800 tokens naive read)',
        savings: '96% Token Savings'
      };
    case 'get_symbol_context':
    default:
      return {
        toolName: 'get_symbol_context',
        targetId: 'src/auth/service.ts#method:UserService.authenticate',
        args: { id: 'src/auth/service.ts#method:UserService.authenticate' },
        reasoning: 'Need complete 360° context: declaration signature, caller controllers, callee crypto functions, references, and module imports.',
        astTarget: 'method_definition: authenticate(user: string, pass: string): Promise<Session>',
        extractedEntity: {
          name: 'authenticate',
          kind: 'method',
          file: 'src/auth/service.ts',
          lines: '42-68',
          signature: 'public async authenticate(username: string, password: string): Promise<Session>'
        },
        sqlQuery: 'SELECT * FROM symbols WHERE id = ?;\nSELECT * FROM relationships WHERE from_key = ? OR to_key = ?;\nSELECT r.*, rn.name FROM "references" r JOIN reference_names rn ON r.name_key = rn.key WHERE r.symbol_key = ?;',
        queryLatency: '0.05 ms',
        responseTokens: '180 tokens (vs 4,800 tokens naive read)',
        savings: '96% Token Savings'
      };
  }
});
</script>

<template>
  <div class="mcp-flow-container">
    <!-- Header with Title & Scenario Switcher -->
    <div class="flow-header">
      <div class="flow-title-group">
        <div class="flow-badge">
          <span class="pulse-dot"></span>
          <span>Interactive Execution Lifecycle</span>
        </div>
        <h3 class="flow-title">How Chanakya MCP Operates: Tool Call to SQLite Retrieval</h3>
        <p class="flow-subtitle">
          Experience the step-by-step pipeline from AI agent tool invocation over stdio, AST parsing, relational SQLite indexing, to sub-millisecond 360° context delivery.
        </p>
      </div>

      <!-- Tool Scenario Switcher -->
      <div class="scenario-selector">
        <span class="scenario-label">Scenario:</span>
        <div class="scenario-pills">
          <button
            v-for="sc in scenarios"
            :key="sc.id"
            class="scenario-pill"
            :class="{ active: activeScenario === sc.id }"
            @click="activeScenario = sc.id"
          >
            <span class="pill-name">{{ sc.label }}</span>
            <span class="pill-tag">{{ sc.badge }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Interactive Node Flow Pipeline (5 Stages) -->
    <div class="pipeline-flow-track">
      <div
        v-for="step in steps"
        :key="step.id"
        class="pipeline-node-wrapper"
      >
        <button
          class="pipeline-node"
          :class="{
            'is-active': currentStep === step.id,
            'is-past': currentStep > step.id,
            'is-future': currentStep < step.id
          }"
          @click="goToStep(step.id)"
        >
          <div class="node-icon-bubble">
            <span class="node-icon">{{ step.icon }}</span>
            <span v-if="currentStep === step.id" class="node-ripple"></span>
          </div>
          <div class="node-text">
            <div class="node-step-tag">Step {{ step.id }}</div>
            <div class="node-name">{{ step.short }}</div>
          </div>
        </button>

        <!-- Connecting Animated Data Beam -->
        <div
          v-if="step.id < 5"
          class="pipeline-connector"
          :class="{
            'beam-active': currentStep >= step.id,
            'beam-flowing': currentStep === step.id && isPlaying
          }"
        >
          <div class="beam-track"></div>
          <div class="beam-glow"></div>
          <div class="beam-pulse-packet"></div>
        </div>
      </div>
    </div>

    <!-- Playback Control Bar -->
    <div class="playback-controls">
      <div class="playback-actions">
        <button
          class="control-btn play-btn"
          :class="{ 'is-playing': isPlaying }"
          @click="togglePlay"
          :title="isPlaying ? 'Pause animation' : 'Auto play animation'"
        >
          <span class="btn-icon">{{ isPlaying ? '⏸' : '▶' }}</span>
          <span>{{ isPlaying ? 'Pause' : 'Auto Play' }}</span>
        </button>
        <button class="control-btn nav-btn" @click="prevStep" title="Previous Step">
          <span>◀ Prev</span>
        </button>
        <button class="control-btn nav-btn" @click="nextStep" title="Next Step">
          <span>Next ▶</span>
        </button>
      </div>

      <div class="playback-meta">
        <div class="step-indicator">
          <span class="step-count">Step {{ currentStep }}/5:</span>
          <span class="step-current-title">{{ steps[currentStep - 1].title }}</span>
        </div>
        <div class="speed-selector">
          <span class="speed-label">Speed:</span>
          <button
            class="speed-btn"
            :class="{ active: playbackSpeed === 1 }"
            @click="setSpeed(1)"
          >1x</button>
          <button
            class="speed-btn"
            :class="{ active: playbackSpeed === 1.5 }"
            @click="setSpeed(1.5)"
          >1.5x</button>
          <button
            class="speed-btn"
            :class="{ active: playbackSpeed === 2 }"
            @click="setSpeed(2)"
          >2x</button>
        </div>
      </div>
    </div>

    <!-- Active Stage Main Visual Card -->
    <div class="stage-display-card">
      <!-- Stage Header Banner -->
      <div class="stage-card-header">
        <div class="stage-badge-group">
          <span class="stage-number-pill">Stage {{ currentStep }}</span>
          <span class="stage-tag-pill">{{ steps[currentStep - 1].tag }}</span>
        </div>
        <div class="stage-header-title">
          <h4>{{ steps[currentStep - 1].title }}</h4>
          <span class="stage-header-subtitle">{{ steps[currentStep - 1].subtitle }}</span>
        </div>
      </div>

      <!-- ============================================================= -->
      <!-- STAGE 1: Tool Calling Animation (JSON-RPC over Stdio) -->
      <!-- ============================================================= -->
      <div v-if="currentStep === 1" class="stage-content-grid">
        <div class="stage-left-panel">
          <div class="panel-box-header">
            <span class="panel-tag ai-tag">🤖 AI Client (Claude Code / Cursor / Windsurf)</span>
            <span class="status-indicator live-pulse">Active Decision</span>
          </div>
          <div class="reasoning-bubble">
            <div class="reasoning-title">Agent Intent & Thought:</div>
            <p>{{ scenarioData.reasoning }}</p>
          </div>

          <div class="stream-channel">
            <div class="stream-header">
              <span class="channel-dot dot-in"></span>
              <span>Communication Channel: <strong>stdio (stdin)</strong></span>
            </div>
            <div class="stream-desc">
              Zero network sockets, zero cloud embeddings, zero telemetry. Client sends pure JSON-RPC 2.0 request into Chanakya stdio daemon.
            </div>
          </div>
        </div>

        <div class="stage-right-panel">
          <div class="panel-box-header">
            <span class="panel-tag mcp-tag">⚡ JSON-RPC 2.0 Tool Call Payload</span>
            <span class="status-indicator validated-pill">✓ Zod Schema Validated</span>
          </div>

          <div class="code-terminal">
            <div class="terminal-bar">
              <span class="term-dot red"></span>
              <span class="term-dot yellow"></span>
              <span class="term-dot green"></span>
              <span class="term-title">JSON-RPC Stdio Stream (stdin)</span>
            </div>
            <pre class="terminal-body"><code>{
  <span class="token-key">"jsonrpc"</span>: <span class="token-str">"2.0"</span>,
  <span class="token-key">"id"</span>: <span class="token-num">42</span>,
  <span class="token-key">"method"</span>: <span class="token-str">"tools/call"</span>,
  <span class="token-key">"params"</span>: {
    <span class="token-key">"name"</span>: <span class="token-fn">"{{ scenarioData.toolName }}"</span>,
    <span class="token-key">"arguments"</span>: {{ JSON.stringify(scenarioData.args, null, 6) }}
  }
}</code></pre>
          </div>

          <div class="callout-tip">
            <span class="tip-icon">💡</span>
            <div class="tip-text">
              <strong>Zod Runtime Validation:</strong> Input parameters are checked in &lt;0.01ms. Stdio isolation keeps stdout strictly reserved for JSON-RPC messages while stderr handles diagnostics.
            </div>
          </div>
        </div>
      </div>

      <!-- ============================================================= -->
      <!-- STAGE 2: Scanning & Tree-Sitter AST Parsing -->
      <!-- ============================================================= -->
      <div v-if="currentStep === 2" class="stage-content-grid">
        <div class="stage-left-panel">
          <div class="panel-box-header">
            <span class="panel-tag scanner-tag">📁 Scanner & Incremental Cache</span>
            <span class="status-indicator check-pill">2-Stage Verification</span>
          </div>

          <div class="pipeline-steps-mini">
            <div class="mini-step completed">
              <span class="mini-icon">✓</span>
              <div class="mini-info">
                <strong>.gitignore Cascade Traversal</strong>
                <span>Scans root, honors nested gitignores, skips node_modules & dist</span>
              </div>
            </div>
            <div class="mini-step completed">
              <span class="mini-icon">✓</span>
              <div class="mini-info">
                <strong>Stage 1: Size & mtime Check</strong>
                <span>Instant stat comparison against SQLite files table (~18ms scan)</span>
              </div>
            </div>
            <div class="mini-step active">
              <span class="mini-icon">⚡</span>
              <div class="mini-info">
                <strong>Stage 2: SHA-256 Content Hash</strong>
                <span>Guarantees racily-clean accuracy on rapid edits</span>
              </div>
            </div>
          </div>

          <div class="stat-highlight-box">
            <div class="stat-item">
              <span class="stat-label">Grammar Engine</span>
              <span class="stat-val">Tree-Sitter C N-API</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Parse Latency</span>
              <span class="stat-val text-brand">~1.2 ms / file</span>
            </div>
          </div>
        </div>

        <div class="stage-right-panel">
          <div class="panel-box-header">
            <span class="panel-tag ast-tag">🌲 Tree-Sitter Concrete Syntax Tree (AST)</span>
            <span class="status-indicator active-tree">Deterministic Tree</span>
          </div>

          <div class="ast-tree-view">
            <div class="ast-node root">
              <span class="node-bracket">▾</span>
              <span class="ast-type">program</span>
              <span class="ast-meta">(src/auth/service.ts)</span>
            </div>
            <div class="ast-node indent-1">
              <span class="node-bracket">▾</span>
              <span class="ast-type">import_statement</span>
              <span class="ast-value">"import { verifyHash } from './crypto.js'"</span>
            </div>
            <div class="ast-node indent-1 highlight-branch">
              <span class="node-bracket">▾</span>
              <span class="ast-type">class_declaration</span>
              <span class="ast-name">UserService</span>
              <span class="ast-meta">Lines 24-118</span>
            </div>
            <div class="ast-node indent-2 highlight-node">
              <span class="node-bracket">▾</span>
              <span class="ast-type">method_definition</span>
              <span class="ast-name">authenticate</span>
              <span class="ast-meta">Lines 42-68</span>
            </div>
            <div class="ast-node indent-3">
              <span class="node-bracket">•</span>
              <span class="ast-type">formal_parameters</span>
              <span class="ast-value">(username: string, password: string)</span>
            </div>
            <div class="ast-node indent-3 call-node">
              <span class="node-bracket">•</span>
              <span class="ast-type">call_expression</span>
              <span class="ast-name">verifyHash(password, user.hash)</span>
            </div>
          </div>

          <div class="callout-tip">
            <span class="tip-icon">🎯</span>
            <div class="tip-text">
              <strong>Concrete AST vs Embeddings:</strong> Tree-Sitter creates exact syntactic nodes with zero probabilistic ambiguity. Every bracket, identifier, and parameter is 100% syntactically anchored.
            </div>
          </div>
        </div>
      </div>

      <!-- ============================================================= -->
      <!-- STAGE 3: Symbol Extraction & Call Graph Detection -->
      <!-- ============================================================= -->
      <div v-if="currentStep === 3" class="stage-content-grid">
        <div class="stage-left-panel">
          <div class="panel-box-header">
            <span class="panel-tag extract-tag">🔍 AST Visitor & Code Model</span>
            <span class="status-indicator">Normalized Models</span>
          </div>

          <div class="extracted-entity-card">
            <div class="entity-title-row">
              <span class="entity-kind-badge">{{ scenarioData.extractedEntity.kind }}</span>
              <span class="entity-name">{{ scenarioData.extractedEntity.name }}</span>
            </div>
            <div class="entity-meta-grid">
              <div class="meta-row">
                <span class="meta-k">Canonical ID:</span>
                <span class="meta-v mono">{{ scenarioData.targetId }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-k">File Bounds:</span>
                <span class="meta-v">{{ scenarioData.extractedEntity.file }} (L{{ scenarioData.extractedEntity.lines }})</span>
              </div>
              <div class="meta-row">
                <span class="meta-k">Signature:</span>
                <span class="meta-v signature mono">{{ scenarioData.extractedEntity.signature }}</span>
              </div>
            </div>
          </div>

          <div class="scope-hierarchy-box">
            <div class="box-label">Enclosing Scope Hierarchy:</div>
            <div class="scope-path">
              <span class="scope-chip">src/auth/service.ts</span>
              <span class="scope-arrow">➔</span>
              <span class="scope-chip">class: UserService</span>
              <span class="scope-arrow">➔</span>
              <span class="scope-chip current">method: authenticate</span>
            </div>
          </div>
        </div>

        <div class="stage-right-panel">
          <div class="panel-box-header">
            <span class="panel-tag graph-tag">🕸️ Relational Graph & Import Resolution</span>
            <span class="status-indicator resolved-pill">Certain + Resolved</span>
          </div>

          <div class="edges-list">
            <div class="edge-card">
              <div class="edge-type contains">CONTAINS</div>
              <div class="edge-body">
                <div class="edge-from">class: UserService</div>
                <div class="edge-to-arrow">── contains ──▶</div>
                <div class="edge-to">method: authenticate</div>
              </div>
              <span class="conf-badge cert">confidence: certain</span>
            </div>

            <div class="edge-card">
              <div class="edge-type calls">CALLS</div>
              <div class="edge-body">
                <div class="edge-from">method: authenticate</div>
                <div class="edge-to-arrow">── invokes ──▶</div>
                <div class="edge-to">function: verifyHash</div>
              </div>
              <span class="conf-badge res">confidence: resolved</span>
            </div>

            <div class="edge-card">
              <div class="edge-type imports">IMPORTS</div>
              <div class="edge-body">
                <div class="edge-from">src/auth/service.ts</div>
                <div class="edge-to-arrow">── imports from ──▶</div>
                <div class="edge-to">src/auth/crypto.ts</div>
              </div>
              <span class="conf-badge cert">confidence: certain</span>
            </div>
          </div>

          <div class="callout-tip">
            <span class="tip-icon">🛡️</span>
            <div class="tip-text">
              <strong>Certainty Guarantees:</strong> Syntactic calls within the same file carry <code>certain</code>. Cross-file calls resolved through static imports carry <code>resolved</code>. No guessed edges.
            </div>
          </div>
        </div>
      </div>

      <!-- ============================================================= -->
      <!-- STAGE 4: Relational SQLite Storage & String Interning -->
      <!-- ============================================================= -->
      <div v-if="currentStep === 4" class="stage-content-grid full-span">
        <div class="sqlite-store-wrapper">
          <div class="sqlite-header-bar">
            <div class="db-brand">
              <span class="db-icon">🗄️</span>
              <div>
                <strong>Embedded SQLite Database</strong>
                <span class="db-path mono">.chanakya/index.db (WAL Mode, Schema v4)</span>
              </div>
            </div>

            <div class="tx-badge">
              <span class="tx-dot"></span>
              <span>ATOMIC TRANSACTION: BEGIN ... COMMIT (20ms)</span>
            </div>
          </div>

          <!-- Table Tabs -->
          <div class="db-table-tabs">
            <button
              class="db-tab"
              :class="{ active: activeSqlTable === 'symbols' }"
              @click="activeSqlTable = 'symbols'"
            >
              symbols (Declarations)
            </button>
            <button
              class="db-tab"
              :class="{ active: activeSqlTable === 'relationships' }"
              @click="activeSqlTable = 'relationships'"
            >
              relationships (Call & Type Edges)
            </button>
            <button
              class="db-tab"
              :class="{ active: activeSqlTable === 'references' }"
              @click="activeSqlTable = 'references'"
            >
              references & reference_names (Interned)
            </button>
            <button
              class="db-tab"
              :class="{ active: activeSqlTable === 'files' }"
              @click="activeSqlTable = 'files'"
            >
              files & imports (Module Graph)
            </button>
          </div>

          <!-- Live SQLite Table Grid -->
          <div class="sqlite-table-container">
            <!-- Symbols Table View -->
            <table v-if="activeSqlTable === 'symbols'" class="mini-sql-table">
              <thead>
                <tr>
                  <th>key</th>
                  <th>id (Canonical)</th>
                  <th>name</th>
                  <th>kind</th>
                  <th>file_id</th>
                  <th>lines</th>
                  <th>signature</th>
                  <th>export_kind</th>
                </tr>
              </thead>
              <tbody>
                <tr class="highlight-row">
                  <td class="mono">104</td>
                  <td class="mono id-cell">src/auth/service.ts#method:UserService.authenticate</td>
                  <td class="mono text-brand">authenticate</td>
                  <td><span class="sql-badge method">method</span></td>
                  <td class="mono">12</td>
                  <td>42:2 - 68:3</td>
                  <td class="mono sig-cell">authenticate(username, password): Promise&lt;Session&gt;</td>
                  <td><span class="sql-badge export">named</span></td>
                </tr>
                <tr>
                  <td class="mono">103</td>
                  <td class="mono id-cell">src/auth/service.ts#class:UserService</td>
                  <td class="mono">UserService</td>
                  <td><span class="sql-badge class">class</span></td>
                  <td class="mono">12</td>
                  <td>24:0 - 118:1</td>
                  <td class="mono sig-cell">class UserService implements IAuthService</td>
                  <td><span class="sql-badge export">named</span></td>
                </tr>
                <tr>
                  <td class="mono">89</td>
                  <td class="mono id-cell">src/auth/crypto.ts#function:verifyHash</td>
                  <td class="mono">verifyHash</td>
                  <td><span class="sql-badge fn">function</span></td>
                  <td class="mono">14</td>
                  <td>15:0 - 32:1</td>
                  <td class="mono sig-cell">verifyHash(raw: string, hash: string): Promise&lt;boolean&gt;</td>
                  <td><span class="sql-badge export">named</span></td>
                </tr>
              </tbody>
            </table>

            <!-- Relationships Table View -->
            <table v-if="activeSqlTable === 'relationships'" class="mini-sql-table">
              <thead>
                <tr>
                  <th>key</th>
                  <th>kind</th>
                  <th>from_key</th>
                  <th>to_key</th>
                  <th>to_name</th>
                  <th>confidence</th>
                  <th>file_id</th>
                  <th>line</th>
                </tr>
              </thead>
              <tbody>
                <tr class="highlight-row">
                  <td class="mono">451</td>
                  <td><span class="sql-badge rel-calls">calls</span></td>
                  <td class="mono">104 (authenticate)</td>
                  <td class="mono">89 (verifyHash)</td>
                  <td class="mono">verifyHash</td>
                  <td><span class="sql-badge resolved">resolved</span></td>
                  <td class="mono">12</td>
                  <td>58</td>
                </tr>
                <tr>
                  <td class="mono">450</td>
                  <td><span class="sql-badge rel-contains">contains</span></td>
                  <td class="mono">103 (UserService)</td>
                  <td class="mono">104 (authenticate)</td>
                  <td class="mono">authenticate</td>
                  <td><span class="sql-badge cert">certain</span></td>
                  <td class="mono">12</td>
                  <td>42</td>
                </tr>
                <tr>
                  <td class="mono">452</td>
                  <td><span class="sql-badge rel-calls">calls</span></td>
                  <td class="mono">210 (AuthController)</td>
                  <td class="mono">104 (authenticate)</td>
                  <td class="mono">authenticate</td>
                  <td><span class="sql-badge resolved">resolved</span></td>
                  <td class="mono">18</td>
                  <td>34</td>
                </tr>
              </tbody>
            </table>

            <!-- References & Interning View -->
            <table v-if="activeSqlTable === 'references'" class="mini-sql-table">
              <thead>
                <tr>
                  <th>ref_key</th>
                  <th>file_id</th>
                  <th>name_key ➔ reference_names(name)</th>
                  <th>symbol_key</th>
                  <th>line:col</th>
                  <th>is_definition</th>
                </tr>
              </thead>
              <tbody>
                <tr class="highlight-row">
                  <td class="mono">1892</td>
                  <td class="mono">18 (routes/auth.ts)</td>
                  <td class="mono text-brand">512 ➔ "authenticate" (Interned)</td>
                  <td class="mono">104</td>
                  <td>34:18</td>
                  <td>0</td>
                </tr>
                <tr>
                  <td class="mono">1893</td>
                  <td class="mono">24 (tests/auth.test.ts)</td>
                  <td class="mono text-brand">512 ➔ "authenticate" (Interned)</td>
                  <td class="mono">104</td>
                  <td>62:12</td>
                  <td>0</td>
                </tr>
                <tr>
                  <td class="mono">1894</td>
                  <td class="mono">12 (src/auth/service.ts)</td>
                  <td class="mono text-brand">512 ➔ "authenticate" (Interned)</td>
                  <td class="mono">104</td>
                  <td>42:15</td>
                  <td>1 (Def)</td>
                </tr>
              </tbody>
            </table>

            <!-- Files View -->
            <table v-if="activeSqlTable === 'files'" class="mini-sql-table">
              <thead>
                <tr>
                  <th>file_id</th>
                  <th>file_path (Canonical)</th>
                  <th>language</th>
                  <th>size</th>
                  <th>content_hash (SHA-256)</th>
                  <th>mtime</th>
                </tr>
              </thead>
              <tbody>
                <tr class="highlight-row">
                  <td class="mono">12</td>
                  <td class="mono">src/auth/service.ts</td>
                  <td>typescript</td>
                  <td>3,420 B</td>
                  <td class="mono hash-cell">a8f5c381...99e1</td>
                  <td class="mono">1773089400</td>
                </tr>
                <tr>
                  <td class="mono">14</td>
                  <td class="mono">src/auth/crypto.ts</td>
                  <td>typescript</td>
                  <td>1,840 B</td>
                  <td class="mono hash-cell">31c8e104...41a2</td>
                  <td class="mono">1773089350</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- B-Trees & Interning Summary -->
          <div class="sql-footer-metrics">
            <div class="metric-pill">
              <span class="k">B-Tree Indexes:</span>
              <span class="v">idx_symbols_name, idx_rel_from, idx_rel_to, idx_refs_name</span>
            </div>
            <div class="metric-pill">
              <span class="k">String Interning:</span>
              <span class="v text-emerald">75% Disk Footprint Reduction</span>
            </div>
            <div class="metric-pill">
              <span class="k">Lookup Speed:</span>
              <span class="v text-brand">~0.03 ms / Query</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ============================================================= -->
      <!-- STAGE 5: Sub-0.05ms Relational Retrieval & Agent Response -->
      <!-- ============================================================= -->
      <div v-if="currentStep === 5" class="stage-content-grid">
        <div class="stage-left-panel">
          <div class="panel-box-header">
            <span class="panel-tag sql-query-tag">⚡ SQL Execution & Context Synthesis</span>
            <span class="status-indicator latency-badge">{{ scenarioData.queryLatency }}</span>
          </div>

          <div class="code-terminal">
            <div class="terminal-bar">
              <span class="term-dot red"></span>
              <span class="term-dot yellow"></span>
              <span class="term-dot green"></span>
              <span class="term-title">Parameterized SQLite Query</span>
            </div>
            <pre class="terminal-body"><code><span class="token-kw">{{ scenarioData.sqlQuery }}</span></code></pre>
          </div>

          <div class="aggregated-context-box">
            <div class="context-box-title">360° Neighborhood Synthesized:</div>
            <div class="context-item">
              <span class="c-dot green"></span>
              <span>Exact AST Coordinates (L42-L68) + Full Type Signature</span>
            </div>
            <div class="context-item">
              <span class="c-dot blue"></span>
              <span>2 Inbound Callers: <code>AuthController.login</code>, <code>ApiKeyMiddleware</code></span>
            </div>
            <div class="context-item">
              <span class="c-dot purple"></span>
              <span>1 Outbound Callee: <code>verifyHash</code> (resolved in crypto.ts)</span>
            </div>
            <div class="context-item">
              <span class="c-dot amber"></span>
              <span>3 Semantic References across 3 files</span>
            </div>
          </div>
        </div>

        <div class="stage-right-panel">
          <div class="panel-box-header">
            <span class="panel-tag response-tag">🚀 JSON-RPC 2.0 Response (stdout)</span>
            <span class="status-indicator tokens-saved-badge">{{ scenarioData.savings }}</span>
          </div>

          <div class="code-terminal">
            <div class="terminal-bar">
              <span class="term-dot red"></span>
              <span class="term-dot yellow"></span>
              <span class="term-dot green"></span>
              <span class="term-title">Stdio Response (stdout ➔ AI Agent)</span>
            </div>
            <pre class="terminal-body response-view"><code>{
  <span class="token-key">"jsonrpc"</span>: <span class="token-str">"2.0"</span>,
  <span class="token-key">"id"</span>: <span class="token-num">42</span>,
  <span class="token-key">"result"</span>: {
    <span class="token-key">"symbol"</span>: {
      <span class="token-key">"name"</span>: <span class="token-str">"authenticate"</span>,
      <span class="token-key">"kind"</span>: <span class="token-str">"method"</span>,
      <span class="token-key">"location"</span>: { <span class="token-key">"file"</span>: <span class="token-str">"src/auth/service.ts"</span>, <span class="token-key">"start_line"</span>: <span class="token-num">42</span>, <span class="token-key">"end_line"</span>: <span class="token-num">68</span> },
      <span class="token-key">"signature"</span>: <span class="token-str">"authenticate(user: string, pass: string): Promise&lt;Session&gt;"</span>
    },
    <span class="token-key">"callers"</span>: [
      { <span class="token-key">"caller"</span>: <span class="token-str">"AuthController.login"</span>, <span class="token-key">"file"</span>: <span class="token-str">"src/routes/auth.ts"</span>, <span class="token-key">"confidence"</span>: <span class="token-str">"resolved"</span> }
    ],
    <span class="token-key">"callees"</span>: [
      { <span class="token-key">"callee"</span>: <span class="token-str">"verifyHash"</span>, <span class="token-key">"file"</span>: <span class="token-str">"src/auth/crypto.ts"</span>, <span class="token-key">"confidence"</span>: <span class="token-str">"resolved"</span> }
    ],
    <span class="token-key">"references_count"</span>: <span class="token-num">3</span>
  }
}</code></pre>
          </div>

          <!-- Token Savings Callout -->
          <div class="token-metric-banner">
            <div class="metric-left">
              <span class="metric-big">180</span>
              <span class="metric-unit">Tokens Used</span>
            </div>
            <div class="metric-divider">vs</div>
            <div class="metric-right">
              <span class="metric-strike">4,800 tokens</span>
              <span class="metric-sub">with naive file reads / grep</span>
            </div>
            <div class="metric-badge-final">96% Token Reduction</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Architecture Comparison Bar -->
    <div class="flow-footer-bar">
      <div class="footer-feature">
        <span class="footer-icon">⚡</span>
        <div>
          <strong>~0.05ms Response Latency</strong>
          <span>Instant SQLite indexed lookup</span>
        </div>
      </div>
      <div class="footer-feature">
        <span class="footer-icon">🔒</span>
        <div>
          <strong>Zero Network Calls</strong>
          <span>100% local embedded SQLite store</span>
        </div>
      </div>
      <div class="footer-feature">
        <span class="footer-icon">🎯</span>
        <div>
          <strong>Zero Hallucinations</strong>
          <span>Compiler-grade Tree-Sitter AST guarantees</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-flow-container {
  margin: 2rem 0 3rem;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.1);
  position: relative;
  overflow: hidden;
}

/* Header */
.flow-header {
  margin-bottom: 24px;
}

.flow-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(2, 132, 199, 0.12);
  border: 1px solid rgba(2, 132, 199, 0.3);
  color: var(--vp-c-brand-1);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 10px;
}

.dark .flow-badge {
  background: rgba(56, 189, 248, 0.16);
  border-color: rgba(56, 189, 248, 0.35);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 10px var(--vp-c-brand-1);
  animation: pulseDot 2s infinite ease-in-out;
}

@keyframes pulseDot {
  0%, 100% { opacity: 0.6; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.3); box-shadow: 0 0 14px var(--vp-c-brand-1); }
}

.flow-title {
  margin: 0 0 6px;
  font-size: 1.45rem;
  font-weight: 800;
  color: var(--vp-c-text-1);
  letter-spacing: -0.02em;
}

.flow-subtitle {
  margin: 0 0 18px;
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

/* Scenario selector */
.scenario-selector {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 14px;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

.scenario-label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.scenario-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.scenario-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 8px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.scenario-pill:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

.scenario-pill.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.pill-tag {
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-3);
}

.scenario-pill.active .pill-tag {
  background: var(--vp-c-brand-1);
  color: #fff;
}

/* Pipeline Track */
.pipeline-flow-track {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 24px 0 20px;
  padding: 10px 0;
  overflow-x: auto;
}

.pipeline-node-wrapper {
  display: flex;
  align-items: center;
  flex: 1;
}

.pipeline-node-wrapper:last-child {
  flex: 0 0 auto;
}

.pipeline-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  transition: all 0.3s ease;
  position: relative;
}

.node-icon-bubble {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vp-c-bg-alt);
  border: 2px solid var(--vp-c-divider);
  position: relative;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.node-icon {
  font-size: 1.4rem;
}

.pipeline-node:hover .node-icon-bubble {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
}

.pipeline-node.is-active .node-icon-bubble {
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 24px var(--codebrain-glow);
  transform: scale(1.1);
}

.pipeline-node.is-active .node-icon {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
}

.pipeline-node.is-past .node-icon-bubble {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.12);
}

.node-ripple {
  position: absolute;
  top: -6px;
  left: -6px;
  right: -6px;
  bottom: -6px;
  border-radius: 50%;
  border: 2px solid var(--vp-c-brand-1);
  animation: rippleGlow 1.8s infinite ease-out;
}

@keyframes rippleGlow {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(1.4); opacity: 0; }
}

.node-text {
  text-align: center;
}

.node-step-tag {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.pipeline-node.is-active .node-step-tag {
  color: var(--vp-c-brand-1);
}

.node-name {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.pipeline-node.is-active .node-name {
  color: var(--vp-c-text-1);
}

/* Connecting Beams */
.pipeline-connector {
  flex: 1;
  height: 4px;
  margin: 0 8px;
  position: relative;
  display: flex;
  align-items: center;
}

.beam-track {
  position: absolute;
  width: 100%;
  height: 3px;
  background: var(--vp-c-divider);
  border-radius: 2px;
}

.pipeline-connector.beam-active .beam-track {
  background: linear-gradient(90deg, #10b981, var(--vp-c-brand-1));
}

.beam-pulse-packet {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 10px var(--vp-c-brand-1);
  opacity: 0;
}

.pipeline-connector.beam-flowing .beam-pulse-packet {
  opacity: 1;
  animation: flowPacket 1.4s infinite linear;
}

@keyframes flowPacket {
  0% { left: 0%; transform: scale(0.6); }
  50% { transform: scale(1.2); }
  100% { left: 95%; transform: scale(0.6); }
}

/* Playback Control Bar */
.playback-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 16px;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  margin-bottom: 20px;
}

.playback-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
  transition: all 0.2s ease;
}

.control-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.play-btn.is-playing {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.playback-meta {
  display: flex;
  align-items: center;
  gap: 18px;
}

.step-indicator {
  font-size: 0.85rem;
}

.step-count {
  font-weight: 700;
  color: var(--vp-c-brand-1);
  margin-right: 6px;
}

.step-current-title {
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.speed-selector {
  display: flex;
  align-items: center;
  gap: 4px;
}

.speed-label {
  font-size: 0.76rem;
  color: var(--vp-c-text-3);
  margin-right: 2px;
}

.speed-btn {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.74rem;
  font-weight: 700;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  cursor: pointer;
}

.speed-btn.active {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
}

/* Main Stage Card */
.stage-display-card {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  padding: 20px;
  min-height: 420px;
  transition: all 0.3s ease;
}

.stage-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  flex-wrap: wrap;
  gap: 10px;
}

.stage-badge-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stage-number-pill {
  padding: 3px 10px;
  border-radius: 6px;
  background: var(--vp-c-brand-1);
  color: #fff;
  font-size: 0.76rem;
  font-weight: 800;
}

.stage-tag-pill {
  padding: 3px 10px;
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font-size: 0.76rem;
  font-weight: 600;
}

.stage-header-title h4 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.stage-header-subtitle {
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
}

/* Grids */
.stage-content-grid {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 20px;
}

.stage-content-grid.full-span {
  grid-template-columns: 1fr;
}

.stage-left-panel, .stage-right-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-box-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-tag {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.ai-tag { color: #818cf8; }
.mcp-tag { color: var(--vp-c-brand-1); }
.scanner-tag { color: #f59e0b; }
.ast-tag { color: #10b981; }
.extract-tag { color: #a855f7; }
.graph-tag { color: #38bdf8; }
.sql-query-tag { color: #eab308; }
.response-tag { color: #10b981; }

.status-indicator {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
}

.live-pulse {
  color: #818cf8;
  background: rgba(129, 140, 248, 0.15);
  border-color: rgba(129, 140, 248, 0.4);
}

.validated-pill, .check-pill {
  color: #10b981;
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.4);
}

.latency-badge {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(245, 158, 11, 0.4);
  font-family: var(--vp-font-family-mono);
}

.tokens-saved-badge {
  color: #10b981;
  background: rgba(16, 185, 129, 0.2);
  border-color: #10b981;
  font-weight: 800;
}

/* Reason box */
.reasoning-bubble {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-left: 3px solid #818cf8;
  border-radius: 10px;
  padding: 12px 14px;
}

.reasoning-title {
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #818cf8;
  margin-bottom: 4px;
}

.reasoning-bubble p {
  margin: 0;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.stream-channel {
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 12px 14px;
}

.stream-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.84rem;
  color: var(--vp-c-text-1);
  margin-bottom: 6px;
}

.channel-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-in { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }

.stream-desc {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  line-height: 1.4;
}

/* Code Terminal */
.code-terminal {
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
}

.terminal-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid var(--vp-c-divider);
}

.term-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.term-dot.red { background: #ef4444; }
.term-dot.yellow { background: #f59e0b; }
.term-dot.green { background: #10b981; }

.term-title {
  font-size: 0.72rem;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
  margin-left: 6px;
}

.terminal-body {
  margin: 0;
  padding: 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--vp-c-text-1);
  overflow-x: auto;
}

.token-key { color: var(--vp-c-brand-1); }
.token-str { color: #10b981; }
.token-num { color: #f59e0b; }
.token-fn { color: #c084fc; font-weight: 700; }
.token-kw { color: #38bdf8; }

.callout-tip {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(2, 132, 199, 0.08);
  border: 1px solid rgba(2, 132, 199, 0.2);
  border-radius: 8px;
}

.tip-icon { font-size: 1.1rem; }
.tip-text { font-size: 0.8rem; color: var(--vp-c-text-2); line-height: 1.45; }

/* Stage 2 AST Tree */
.pipeline-steps-mini {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mini-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.mini-step.active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.mini-icon {
  font-size: 0.85rem;
  font-weight: 800;
  color: #10b981;
}

.mini-step.active .mini-icon {
  color: var(--vp-c-brand-1);
}

.mini-info strong {
  display: block;
  font-size: 0.82rem;
  color: var(--vp-c-text-1);
}

.mini-info span {
  font-size: 0.74rem;
  color: var(--vp-c-text-3);
}

.stat-highlight-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  background: var(--vp-c-bg-alt);
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
}

.stat-item {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
}

.stat-val {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.text-brand { color: var(--vp-c-brand-1) !important; }
.text-emerald { color: #10b981 !important; }

/* AST Tree View */
.ast-tree-view {
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ast-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 4px;
}

.node-bracket { color: var(--vp-c-text-3); }
.ast-type { color: #38bdf8; font-weight: 600; }
.ast-name { color: #f59e0b; font-weight: 700; }
.ast-meta { color: var(--vp-c-text-3); font-size: 0.72rem; }
.ast-value { color: #10b981; }

.indent-1 { margin-left: 16px; }
.indent-2 { margin-left: 32px; }
.indent-3 { margin-left: 48px; }

.highlight-branch {
  background: rgba(56, 189, 248, 0.08);
}

.highlight-node {
  background: rgba(16, 185, 129, 0.15);
  border-left: 2px solid #10b981;
}

.call-node {
  background: rgba(168, 85, 247, 0.12);
  border-left: 2px solid #a855f7;
}

/* Stage 3 extraction */
.extracted-entity-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 14px;
}

.entity-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.entity-kind-badge {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(168, 85, 247, 0.18);
  border: 1px solid rgba(168, 85, 247, 0.4);
  color: #c084fc;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}

.entity-name {
  font-family: var(--vp-font-family-mono);
  font-size: 1rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.entity-meta-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
}

.meta-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px;
}

.meta-k { color: var(--vp-c-text-3); }
.meta-v { color: var(--vp-c-text-2); word-break: break-all; }
.meta-v.mono { font-family: var(--vp-font-family-mono); }
.meta-v.signature { color: var(--vp-c-brand-1); font-weight: 600; }

.scope-hierarchy-box {
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 12px;
}

.box-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  margin-bottom: 8px;
}

.scope-path {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.scope-chip {
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  font-size: 0.74rem;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
}

.scope-chip.current {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.scope-arrow {
  color: var(--vp-c-text-3);
  font-size: 0.7rem;
}

/* Edges */
.edges-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edge-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  gap: 8px;
}

.edge-type {
  font-size: 0.68rem;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
}

.edge-type.contains { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
.edge-type.calls { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.edge-type.imports { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }

.edge-body {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
}

.edge-to-arrow { color: var(--vp-c-text-3); font-size: 0.7rem; }
.edge-from { color: var(--vp-c-text-2); }
.edge-to { color: var(--vp-c-brand-1); font-weight: 600; }

.conf-badge {
  font-size: 0.66rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 9999px;
}
.conf-badge.cert { background: rgba(16, 185, 129, 0.15); color: #10b981; }
.conf-badge.res { background: rgba(2, 132, 199, 0.15); color: var(--vp-c-brand-1); }

/* Stage 4 SQLite */
.sqlite-store-wrapper {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sqlite-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--vp-c-bg-alt);
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
  flex-wrap: wrap;
  gap: 10px;
}

.db-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.db-icon { font-size: 1.5rem; }
.db-path { font-size: 0.74rem; color: var(--vp-c-text-3); display: block; }

.tx-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid #10b981;
  color: #10b981;
  font-size: 0.74rem;
  font-weight: 700;
  font-family: var(--vp-font-family-mono);
}

.tx-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}

.db-table-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.db-tab {
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font-size: 0.78rem;
  font-weight: 600;
  font-family: var(--vp-font-family-mono);
  cursor: pointer;
  transition: all 0.2s ease;
}

.db-tab.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.sqlite-table-container {
  overflow-x: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-alt);
}

.mini-sql-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
  margin: 0 !important;
}

.mini-sql-table th {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-weight: 700;
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--vp-c-divider);
  white-space: nowrap;
}

.mini-sql-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.mini-sql-table tr:last-child td {
  border-bottom: none;
}

.highlight-row {
  background: rgba(2, 132, 199, 0.08);
}

.sql-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
}

.sql-badge.method { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.sql-badge.class { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
.sql-badge.fn { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.sql-badge.export { background: rgba(16, 185, 129, 0.15); color: #10b981; }
.sql-badge.rel-calls { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.sql-badge.rel-contains { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
.sql-badge.resolved { background: rgba(2, 132, 199, 0.15); color: var(--vp-c-brand-1); }
.sql-badge.cert { background: rgba(16, 185, 129, 0.15); color: #10b981; }

.id-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.sig-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; color: var(--vp-c-text-1); }
.hash-cell { font-family: var(--vp-font-family-mono); color: var(--vp-c-text-3); }

.sql-footer-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.metric-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  font-size: 0.76rem;
}

.metric-pill .k { color: var(--vp-c-text-3); }
.metric-pill .v { font-weight: 700; font-family: var(--vp-font-family-mono); }

/* Stage 5 Context & Response */
.aggregated-context-box {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.context-box-title {
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  margin-bottom: 2px;
}

.context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}

.context-item code {
  font-size: 0.76rem;
  color: var(--vp-c-brand-1);
}

.c-dot { width: 7px; height: 7px; border-radius: 50%; }
.c-dot.green { background: #10b981; }
.c-dot.blue { background: #38bdf8; }
.c-dot.purple { background: #c084fc; }
.c-dot.amber { background: #f59e0b; }

.response-view {
  max-height: 220px;
}

.token-metric-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(2, 132, 199, 0.12) 100%);
  border: 1px solid rgba(16, 185, 129, 0.35);
  flex-wrap: wrap;
  gap: 10px;
}

.metric-left {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.metric-big {
  font-size: 1.6rem;
  font-weight: 900;
  color: #10b981;
  font-family: var(--vp-font-family-mono);
}

.metric-unit {
  font-size: 0.8rem;
  font-weight: 700;
  color: #10b981;
}

.metric-divider {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  font-style: italic;
}

.metric-right {
  display: flex;
  flex-direction: column;
}

.metric-strike {
  font-size: 0.85rem;
  text-decoration: line-through;
  color: #ef4444;
  font-family: var(--vp-font-family-mono);
}

.metric-sub {
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
}

.metric-badge-final {
  padding: 4px 10px;
  border-radius: 9999px;
  background: #10b981;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 800;
}

/* Footer Bar */
.flow-footer-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--vp-c-divider);
}

.footer-feature {
  display: flex;
  align-items: center;
  gap: 12px;
}

.footer-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
}

.footer-feature strong {
  display: block;
  font-size: 0.84rem;
  color: var(--vp-c-text-1);
}

.footer-feature span {
  font-size: 0.74rem;
  color: var(--vp-c-text-3);
}

@media (max-width: 768px) {
  .stage-content-grid {
    grid-template-columns: 1fr;
  }

  .meta-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .playback-meta {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
