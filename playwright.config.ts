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
    command: 'npx tsx src/cli.ts --demo:4 --no-open --strict-port --port 4183',
    port: 4183,
    reuseExistingServer: false,
    timeout: 15000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
