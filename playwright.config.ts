import { tmpdir } from 'os';
import { join } from 'path';

import { defineConfig } from '@playwright/test';

// The `--diff` E2E project (doc 18) needs an isolated cwd/data-dir so the
// `.glassbox/` artifacts it writes don't collide with the demo run or the
// developer's real Glassbox state. A pid-scoped tmpdir gives each playwright
// invocation a fresh review.
const DIFF_WORK_DIR = join(tmpdir(), `glassbox-e2e-diff-${process.pid}`);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4183',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: process.env.SKIP_WEBSERVER ? undefined : [
    {
      // `--ai-service-test` makes AI analysis use mock responses and bypass the
      // API-key check, so the suite is hermetic. Without it, any test that
      // triggers a real risk/narrative analysis (e.g. the sort-mode stability
      // test) only passes on a machine that happens to have a real API key
      // configured (env / keychain / config file). CI has no key, so the
      // analysis POST returns 400 "No API key configured" and the browser logs
      // a failed-resource console error that the failOnPageError fixture trips
      // on. Mocking AI removes that environment dependence entirely.
      command: 'npx tsx src/cli.ts --demo:4 --ai-service-test --no-open --strict-port --port 4183',
      port: 4183,
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      // Direct-comparison E2E server (doc 18). Boots `--diff` against the
      // checked-in fixture folders under `tests/fixtures/diff/{old,new}` and
      // anchors its `.glassbox/` data + export under a pid-scoped tmpdir so
      // each playwright run starts from a clean slate. The `mkdir -p` runs
      // first because the CLI chdirs into `--project-dir` before creating
      // anything itself.
      command: `mkdir -p ${JSON.stringify(DIFF_WORK_DIR)} && npx tsx src/cli.ts --diff tests/fixtures/diff/old tests/fixtures/diff/new --no-open --strict-port --port 4184 --data-dir ${JSON.stringify(join(DIFF_WORK_DIR, '.glassbox'))} --project-dir ${JSON.stringify(DIFF_WORK_DIR)}`,
      port: 4184,
      reuseExistingServer: false,
      timeout: 15000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /diff-mode\.test\.ts$/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'chromium-diff',
      testMatch: /diff-mode\.test\.ts$/,
      use: { browserName: 'chromium', baseURL: 'http://localhost:4184' },
    },
  ],
});
