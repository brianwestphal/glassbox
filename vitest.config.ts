import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: 'coverage',
      all: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/client/styles/**',
      ],
    },
  },
  resolve: {
    alias: {
      '#jsx/jsx-runtime': './src/jsx-runtime.ts',
      '#jsx/jsx-dev-runtime': './src/jsx-runtime.ts',
    },
  },
});
