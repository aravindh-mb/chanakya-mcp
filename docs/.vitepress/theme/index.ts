import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import BenchChart from './BenchChart.vue';
import AgentTabs from './AgentTabs.vue';
import ToolPlayground from './ToolPlayground.vue';
import HeroStars from './HeroStars.vue';
import McpFlowAnimation from './McpFlowAnimation.vue';
import './custom.css';

/**
 * Enhanced VitePress theme with custom components and modern styling.
 */
export default {
  extends: DefaultTheme,
  Layout: DefaultTheme.Layout,
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx);
    ctx.app.component('BenchChart', BenchChart);
    ctx.app.component('AgentTabs', AgentTabs);
    ctx.app.component('ToolPlayground', ToolPlayground);
    ctx.app.component('HeroStars', HeroStars);
    ctx.app.component('McpFlowAnimation', McpFlowAnimation);
  },
} satisfies Theme;
