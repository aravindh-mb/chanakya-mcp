import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Code Intelligence MCP',
  description:
    'A local MCP server that gives AI coding agents deep structural knowledge of a JavaScript/TypeScript codebase.',
  lastUpdated: true,

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/mcp-tools' },
      { text: 'Roadmap', link: '/roadmap' },
      {
        text: 'GitHub',
        link: 'https://github.com/aravindh-mb/codebrain-mcp',
      },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Scanning & Languages', link: '/guide/scanning' },
          { text: 'Code Model & Extraction', link: '/guide/code-model' },
          { text: 'Search', link: '/guide/search' },
          { text: 'Edits', link: '/guide/edits' },
          { text: 'Security', link: '/guide/security' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'MCP Tools', link: '/reference/mcp-tools' },
          { text: 'Index & Performance', link: '/reference/index' },
          { text: 'Architecture', link: '/reference/architecture' },
        ],
      },
    ],

    editLink: {
      pattern: 'https://github.com/aravindh-mb/codebrain-mcp/edit/master/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'MIT Licensed',
      copyright: 'Copyright © 2026',
    },

    search: {
      provider: 'local',
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/aravindh-mb/codebrain-mcp' }],
  },
});
