import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Chanakya MCP',
  description:
    'High-performance local Model Context Protocol server delivering deep structural AST intelligence and 80-93% token reduction for AI coding agents.',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#38bdf8' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Chanakya MCP - Deep Structural Code Intelligence for AI Agents' }],
    ['meta', { property: 'og:description', content: 'Supercharge Claude Code, Cursor, and Windsurf with exact AST symbol graphs, local SQLite indexing, and atomic safe edits. 80-93% token savings.' }],
    ['meta', { property: 'og:image', content: '/architecture-diagram.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
      },
    ],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Chanakya MCP',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/reference/architecture' },
      { text: 'Tools (14)', link: '/reference/mcp-tools' },
      { text: 'Benchmarks', link: '/guide/benchmarks' },
      { text: 'Security', link: '/guide/security' },
      { text: 'Roadmap', link: '/roadmap' },
      {
        text: 'v1.1.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/aravindh-mb/chanakya-mcp/blob/master/CHANGELOG.md' },
          { text: 'npm package', link: 'https://www.npmjs.com/package/@aravindh-arumugam/chanakya-mcp' },
        ],
      },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        collapsed: false,
        items: [
          { text: 'Overview & Quickstart', link: '/guide/getting-started' },
          { text: 'Docker Deployment', link: '/guide/docker' },
          { text: 'Scanning & Grammars', link: '/guide/scanning' },
          { text: 'Code Model & AST Graph', link: '/guide/code-model' },
        ],
      },
      {
        text: 'Core Features',
        collapsed: false,
        items: [
          { text: 'Symbol & Code Search', link: '/guide/search' },
          { text: 'Safe & Atomic Edits', link: '/guide/edits' },
          { text: 'Benchmarks & Token Savings', link: '/guide/benchmarks' },
          { text: 'Security & Sandboxing', link: '/guide/security' },
        ],
      },
      {
        text: 'Technical Reference',
        collapsed: false,
        items: [
          { text: '14 MCP Tools Spec', link: '/reference/mcp-tools' },
          { text: 'SQLite Index & Interning', link: '/reference/index' },
          { text: 'System Architecture', link: '/reference/architecture' },
          { text: 'Production Status & Roadmap', link: '/roadmap' },
        ],
      },
    ],

    editLink: {
      pattern: 'https://github.com/aravindh-mb/chanakya-mcp/edit/master/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License. Zero data telemetry â€” 100% local execution.',
      copyright: 'Copyright Â© 2026 Chanakya MCP Contributors',
    },

    search: {
      provider: 'local',
      options: {
        detailedView: true,
      },
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/aravindh-mb/chanakya-mcp' },
    ],
  },
});

