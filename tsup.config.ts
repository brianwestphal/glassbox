import { defineConfig } from 'tsup';
import { execSync } from 'child_process';

export default defineConfig([
  // Server bundle (CLI entry point)
  {
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
    define: {
      'process.env.BUILD_TIMESTAMP': JSON.stringify(new Date().toISOString()),
    },
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
  },
  // Client bundle (browser JS + SCSS)
  {
    entry: ['src/client/app.ts'],
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
      options.jsxImportSource = '#jsx';
      options.alias = {
        '#jsx/jsx-runtime': './src/jsx-runtime.ts',
      };
    },
    onSuccess: async () => {
      // Build SCSS
      execSync('npx sass src/client/styles.scss dist/client/styles.css --style compressed --no-source-map', { stdio: 'inherit' });
    },
  },
]);
