import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  outDir: 'dist',
  target: 'node20',
  platform: 'node',
  splitting: false,
  clean: true,
  sourcemap: true,
  // Bundle everything except node_modules dependencies
  noExternal: [/^(?!@electric-sql|hono|@hono)/],
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.jsxImportSource = '#jsx';
    // Resolve the #jsx import to our local jsx-runtime
    options.alias = {
      '#jsx/jsx-runtime': './src/jsx-runtime.ts',
    };
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
