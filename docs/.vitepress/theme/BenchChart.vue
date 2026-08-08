<script setup>
import benchmark from '../sample-benchmark.json';

const questions = benchmark.questions;
const summary = benchmark.summary;

/** The longest bar sets the scale, so rows stay comparable. */
const max_tokens = Math.max(...questions.map((question) => question.naive.tokens));

function width_percent(tokens) {
  // Floored so a small-but-real value still renders as a visible mark.
  return Math.max((tokens / max_tokens) * 100, 1.2);
}

function saved_label(question) {
  const saved = question.context_saved_pct;
  return saved >= 0 ? `${saved}% less` : `${Math.abs(saved)}% more`;
}
</script>

<template>
  <div class="viz-root">
    <!-- A single headline value is a stat tile, not a chart. -->
    <div class="stat-row">
      <div class="stat">
        <div class="stat-value">{{ summary.context_saved_pct }}%</div>
        <div class="stat-label">less context per question</div>
      </div>
      <div class="stat">
        <div class="stat-value">{{ summary.median_speedup }}&times;</div>
        <div class="stat-label">median faster to answer</div>
      </div>
      <div class="stat">
        <div class="stat-value">
          {{ summary.context_tokens_naive.toLocaleString() }}
          <span class="stat-arrow">&rarr;</span>
          {{ summary.context_tokens_mcp.toLocaleString() }}
        </div>
        <div class="stat-label">tokens across all {{ questions.length }} questions</div>
      </div>
    </div>

    <!-- Two series, so a legend is always present; bars are direct-labeled too. -->
    <div class="legend">
      <span class="legend-item">
        <span class="swatch swatch-naive" aria-hidden="true"></span>
        Without the MCP (grep, then read the files it hit)
      </span>
      <span class="legend-item">
        <span class="swatch swatch-mcp" aria-hidden="true"></span>
        With the MCP (one tool call)
      </span>
    </div>

    <div class="chart">
      <div v-for="question in questions" :key="question.name" class="row">
        <div class="row-head">
          <span class="row-name">{{ question.name }}</span>
          <span class="row-saved" :class="{ negative: question.context_saved_pct < 0 }">
            {{ saved_label(question) }}
          </span>
        </div>

        <div class="bars">
          <div class="bar-line">
            <div class="bar bar-naive" :style="{ width: width_percent(question.naive.tokens) + '%' }"></div>
            <span class="bar-value">{{ question.naive.tokens.toLocaleString() }}</span>
          </div>
          <div class="bar-line">
            <div class="bar bar-mcp" :style="{ width: width_percent(question.mcp.tokens) + '%' }"></div>
            <span class="bar-value">{{ question.mcp.tokens.toLocaleString() }}</span>
          </div>
        </div>

        <p class="row-ask">{{ question.ask }}</p>
      </div>
    </div>

    <p class="axis-note">
      Bars show approximate tokens entering the agent's context (bytes &divide; 4). Measured on
      {{ benchmark.project.files }} files / {{ benchmark.project.symbols }} symbols, median of
      {{ benchmark.runs }} runs on Node {{ benchmark.node_version }}.
    </p>
  </div>
</template>

<style scoped>
/*
 * Categorical slots 1 and 2 from the validated palette. Both modes were checked
 * with the palette validator: lightness band, chroma floor, CVD separation,
 * normal-vision floor and contrast all pass against both surfaces.
 */
.viz-root {
  --series-naive: #eb6834;
  --series-mcp: #2a78d6;
  margin: 1.5rem 0 2rem;
}
:root.dark .viz-root {
  --series-naive: #d95926;
  --series-mcp: #3987e5;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin-bottom: 1.75rem;
}
.stat {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 16px 18px;
}
.stat-value {
  font-size: 1.7rem;
  font-weight: 700;
  line-height: 1.15;
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
}
.stat-arrow {
  color: var(--vp-c-text-3);
  font-weight: 400;
  margin: 0 2px;
}
.stat-label {
  margin-top: 4px;
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-bottom: 1.25rem;
  font-size: 0.82rem;
  color: var(--vp-c-text-2);
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex: none;
}
.swatch-naive {
  background: var(--series-naive);
}
.swatch-mcp {
  background: var(--series-mcp);
}

.row {
  padding: 14px 0;
  border-top: 1px solid var(--vp-c-divider);
}
.row-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}
.row-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.row-saved {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.row-saved.negative {
  color: var(--vp-c-text-3);
}

/* A 2px gap keeps the two fills from reading as a single mark. */
.bars {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bar-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bar {
  height: 12px;
  /* Rounded data-end, square against the baseline. */
  border-radius: 0 4px 4px 0;
  min-width: 3px;
}
.bar-naive {
  background: var(--series-naive);
}
.bar-mcp {
  background: var(--series-mcp);
}
.bar-value {
  font-size: 0.75rem;
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.row-ask {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}

.axis-note {
  margin-top: 1.25rem;
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 10px;
}
</style>
