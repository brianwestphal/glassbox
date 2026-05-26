import { defineConfig } from 'tsup';
import { execSync } from 'child_process';

export default defineConfig([
  // Server bundle (CLI entry point + channel server + SVG rasterization worker).
  // Object form pins output filenames so the worker lands at
  // dist/svg-rasterize-worker.js (a sibling of cli.js), which the rasterization
  // manager resolves at runtime via `new URL('./svg-rasterize-worker.js', …)`.
  {
    entry: {
      cli: 'src/cli.ts',
      channel: 'src/channel.ts',
      'svg-rasterize-worker': 'src/git/svg-rasterize-worker.ts',
    },
    format: 'esm',
    outDir: 'dist',
    target: 'node20',
    platform: 'node',
    splitting: false,
    clean: true,
    sourcemap: true,
    // Bundle everything except node_modules dependencies
    noExternal: [/^(?!@electric-sql|hono|@hono|@resvg|@modelcontextprotocol|kerfjs|@preact)/],
    define: {
      'process.env.BUILD_TIMESTAMP': JSON.stringify(new Date().toISOString()),
    },
    esbuildOptions(options) {
      options.jsx = 'automatic';
      options.jsxImportSource = 'kerfjs';
    },
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Client bundle (browser JS + SCSS)
  {
    entry: ['src/client/app.tsx', 'src/client/history.tsx'],
    format: 'iife',
    outDir: 'dist/client',
    target: 'es2020',
    platform: 'browser',
    splitting: false,
    clean: false,
    sourcemap: false,
    minify: true,
    esbuildOptions(options) {
      options.jsx = 'automatic';
      options.jsxImportSource = 'kerfjs';
    },
    onSuccess: async () => {
      // Build SCSS
      execSync('npx sass src/client/styles.scss dist/client/styles.css --style compressed --no-source-map', { stdio: 'inherit' });
    },
  },
]);
