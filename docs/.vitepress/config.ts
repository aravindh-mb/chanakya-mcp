import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Chanakya MCP',
  titleTemplate: ':title | Chanakya MCP - Structural Code Intelligence',
  description:
    'Chanakya MCP: High-performance local Model Context Protocol (MCP) server delivering deep structural Tree-Sitter AST intelligence and 80-93% token reduction for AI coding agents (Claude Code, Cursor, Windsurf).',
  lastUpdated: true,
  cleanUrls: true,

  sitemap: {
    hostname: 'https://chanakyamcp.vercel.app',
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['link', { rel: 'canonical', href: 'https://chanakyamcp.vercel.app/' }],
    ['meta', { name: 'theme-color', content: '#38bdf8' }],

    // Google tag (gtag.js)
    [
      'script',
      {
        async: '',
        src: 'https://www.googletagmanager.com/gtag/js?id=G-LYLJR9CC46',
      },
    ],
    [
      'script',
      {},
      `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-LYLJR9CC46');`,
    ],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'chanakya, chanakya mcp, chanakyamcp, chanakya ai, chanakya tool, model context protocol, mcp server, mcp tools, code intelligence, ast static analysis, tree-sitter, claude code mcp, cursor mcp, windsurf mcp, roo code, cline mcp, sqlite index, token reduction, local mcp, zero embeddings',
      },
    ],
    ['meta', { name: 'author', content: 'Aravindh Arumugam' }],
    ['meta', { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' }],

    // Open Graph / Facebook / LinkedIn
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Chanakya MCP' }],
    ['meta', { property: 'og:url', content: 'https://chanakyamcp.vercel.app/' }],
    [
      'meta',
      {
        property: 'og:title',
        content: 'Chanakya MCP - Deterministic Structural Code Intelligence for AI Agents',
      },
    ],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Supercharge Claude Code, Cursor, and Windsurf with exact AST symbol graphs, local SQLite indexing, and atomic safe edits. 80-93% token reduction with zero cloud embeddings and zero network calls.',
      },
    ],
    ['meta', { property: 'og:image', content: 'https://chanakyamcp.vercel.app/architecture-diagram.svg' }],
    ['meta', { property: 'og:image:alt', content: 'Chanakya MCP Architecture Overview' }],
    ['meta', { property: 'og:locale', content: 'en_US' }],

    // Twitter Cards
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:site', content: '@aravindh_mb' }],
    ['meta', { name: 'twitter:creator', content: '@aravindh_mb' }],
    [
      'meta',
      {
        name: 'twitter:title',
        content: 'Chanakya MCP - Structural Code Intelligence for AI Agents',
      },
    ],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Local Model Context Protocol server with compiler-grade AST static analysis and relational SQLite indexing. 95% token savings for AI coding agents.',
      },
    ],
    ['meta', { name: 'twitter:image', content: 'https://chanakyamcp.vercel.app/architecture-diagram.svg' }],

    // Fonts Preconnect
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
      },
    ],

    // JSON-LD Structured Data Schema for Google Search
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            '@id': 'https://chanakyamcp.vercel.app/#website',
            url: 'https://chanakyamcp.vercel.app/',
            name: 'Chanakya MCP',
            alternateName: ['Chanakya', 'ChanakyaMCP', 'Chanakya Code Intelligence'],
            description: 'Deterministic Structural Code Intelligence for AI Agents',
            publisher: {
              '@type': 'Person',
              name: 'Aravindh Arumugam',
              url: 'https://github.com/aravindh-mb',
            },
          },
          {
            '@type': 'SoftwareApplication',
            '@id': 'https://chanakyamcp.vercel.app/#software',
            name: 'Chanakya MCP',
            alternateName: ['Chanakya', 'chanakya-mcp', 'Chanakya Model Context Protocol'],
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'Cross-platform (macOS, Linux, Windows)',
            url: 'https://chanakyamcp.vercel.app/',
            downloadUrl: 'https://www.npmjs.com/package/@aravindh-arumugam/chanakya-mcp',
            softwareVersion: '2.0.2',
            description:
              'High-performance local Model Context Protocol (MCP) server delivering Tree-Sitter AST intelligence and 80-93% token reduction for Claude Code, Cursor, and Windsurf.',
            license: 'https://opensource.org/licenses/MIT',
            author: {
              '@type': 'Person',
              name: 'Aravindh Arumugam',
              url: 'https://github.com/aravindh-mb',
            },
          },
        ],
      }),
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
        text: 'v2.0.2',
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
      message: 'Released under the MIT License. Zero data telemetry — 100% local execution.',
      copyright: 'Copyright © 2026 Chanakya MCP Contributors',
    },

    search: {
      provider: 'local',
      options: {
        detailedView: true,
      },
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/aravindh-mb/chanakya-mcp' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@aravindh-arumugam/chanakya-mcp' },
    ],
  },
});
