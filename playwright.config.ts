import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4183',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: process.env.SKIP_WEBSERVER ? undefined : {
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
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
