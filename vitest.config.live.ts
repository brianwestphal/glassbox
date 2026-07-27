import { defineConfig } from 'vitest/config';

/**
 * Opt-in config for the **live-render** plugin tests (`npm run test:live`).
 *
 * The PlantUML and Mermaid plugins render by spawning a real JVM and a real
 * headless Chromium. Those subprocesses are far heavier than anything else in
 * the suite, and under the default run they were competing with ~150 other test
 * files for CPU: the JVM blew a 30s timeout and Chromium failed to launch
 * outright, while both passed in seconds when run alone. Timeout bumps only
 * moved the threshold (the Mermaid test was already at 60s and still failed on
 * *launch*, not on time), so the fix is to stop them racing the suite at all.
 *
 * The live tests are gated on `GLASSBOX_LIVE_RENDER_TESTS`, which this config
 * sets and the default config does not — so `npm test` skips them and stays
 * deterministic, and this config runs them with `fileParallelism: false` so the
 * JVM and the browser don't even contend with each other. Setting the variable
 * through `test.env` rather than a shell prefix keeps the npm script portable to
 * Windows.
 *
 * Both tests are additionally gated on their tooling being present, so this
 * config still skips whatever isn't installed (see each file's `describe.skipIf`
 * and the `setup.mjs` helper in each plugin directory).
 */
export default defineConfig({
  test: {
    globals: true,
    include: [
      'tests/unit/plugins/mermaid.test.ts',
      'tests/unit/plugins/plantuml.test.ts',
    ],
    fileParallelism: false,
    env: {
      GLASSBOX_LIVE_RENDER_TESTS: '1',
    },
  },
});
