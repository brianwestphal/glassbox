import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    // Cold PGlite (WASM) boot in a DB test's `beforeAll` (`setupTestDb`) can
    // exceed the 10s default when the machine is loaded — ~160 test files run
    // concurrently, and a busy runner made 6 DB files' hooks time out at once
    // (GB-1159). 30s gives WASM init room without masking a genuinely hung
    // setup (which still fails at 30s). Tests themselves keep the default.
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      all: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/client/styles/**',
      ],
    },
  },
});
