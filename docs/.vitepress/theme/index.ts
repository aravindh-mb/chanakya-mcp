import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import BenchChart from './BenchChart.vue';

/**
 * Registers the benchmark chart globally so pages can drop `<BenchChart />` in.
 *
 * The component reads `.vitepress/sample-benchmark.json`, which `pnpm run
 * bench:sample` regenerates, so the published numbers move with the benchmark
 * instead of being copied into prose and going stale.
 */
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('BenchChart', BenchChart);
  },
} satisfies Theme;
