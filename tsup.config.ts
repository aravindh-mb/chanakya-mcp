import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/main': 'src/cli/main.ts',
    // Started by the analysis pool as a worker thread; see src/indexer/analyze_pool.ts.
    'indexer/analyze_worker': 'src/indexer/analyze_worker.ts',
  },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  outDir: 'dist',
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  shims: false,
  minify: true,
  minifyIdentifiers: true,
  minifySyntax: true,
  minifyWhitespace: true,
});
