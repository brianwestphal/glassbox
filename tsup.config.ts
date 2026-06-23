import { defineConfig } from 'tsup';
import { execSync } from 'child_process';

export default defineConfig([
  // Server bundle (CLI entry point + channel server).
  {
    entry: {
      cli: 'src/cli.ts',
      'cli-difftool': 'src/cli-difftool.ts',
      channel: 'src/channel.ts',
    },
    format: 'esm',
    outDir: 'dist',
    target: 'node20',
    platform: 'node',
    splitting: false,
    clean: true,
    sourcemap: true,
    // Bundle everything except node_modules dependencies. `apple-fm` MUST stay
    // external: it locates its bundled native helper (`bin/apple-fm-helper`)
    // relative to its own package directory, so it has to live in the sidecar's
    // node_modules rather than being inlined into cli.js.
    noExternal: [/^(?!@electric-sql|hono|@hono|@modelcontextprotocol|kerfjs|@preact|apple-fm)/],
    define: {
      'process.env.BUILD_TIMESTAMP': JSON.stringify(new Date().toISOString()),
    },
    esbuildOptions(options) {
      options.jsx = 'automatic';
      options.jsxImportSource = 'kerfjs';
    },
    banner: {
      // Shebang + a createRequire shim. The bundle is ESM, but some bundled
      // CJS deps (e.g. pngjs, used by the ground-truth perceptual diff) call
      // `require('util')` internally; without this shim esbuild's `__require`
      // throws "Dynamic require of \"util\" is not supported" at runtime, which
      // crashed `glassbox --ground-truth` in the production bundle (GB-976).
      js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'module';\nconst require = __createRequire(import.meta.url);",
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
