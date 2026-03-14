import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/client/**',
        'src/components/**',
        'src/routes/pages.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '#jsx/jsx-runtime': './src/jsx-runtime.ts',
    },
  },
});
