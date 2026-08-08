import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/main': 'src/cli/main.ts',
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
