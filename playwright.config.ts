import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { defineConfig } from '@playwright/test';

// The `--diff` E2E project (doc 18) needs an isolated cwd/data-dir so the
// `.glassbox/` artifacts it writes don't collide with the demo run or the
// developer's real Glassbox state. A pid-scoped tmpdir gives each playwright
// invocation a fresh review.
const DIFF_WORK_DIR = join(tmpdir(), `glassbox-e2e-diff-${process.pid}`);

// Isolate the demo server's GLOBAL config (`~/.glassbox/config.json` + custom
// themes) under a disposable pid-scoped dir via GLASSBOX_CONFIG_DIR (GB-923).
// Without this the suite reads/writes the developer's real `~/.glassbox`, so
// the settings tests silently overwrite their AI platform/keys and the
// local-platform test becomes machine-dependent (failing when the real config
// already selects `local`). A fresh empty dir also gives every run a
// deterministic default platform (`anthropic`).
const DEMO_CONFIG_DIR = join(tmpdir(), `glassbox-e2e-config-${process.pid}`);

// Create the work dirs here (config eval runs before the webServers) rather than
// via a shell `mkdir -p` in the webServer command — the CLI chdirs into
// `--project-dir` before creating anything itself, so the dir must exist first.
// Doing it in Node keeps it cross-platform (`mkdir -p` isn't valid on Windows
// `cmd`, where it spuriously creates a `-p` dir and then errors on reruns).
mkdirSync(DIFF_WORK_DIR, { recursive: true });
mkdirSync(DEMO_CONFIG_DIR, { recursive: true });

// Optionally launch a branded, system-installed browser instead of Playwright's
// bundled Chromium. Unset by default (CI/dev use the bundled build); set
// `PW_CHANNEL=chrome` (or `msedge`) to run against the installed browser — the
// way to run this suite on Windows-on-ARM, where Playwright ships no native
// arm64 Chromium and the bundled x64 build would run under slow emulation.
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  retries: 1,
  // Run serially under CI. The whole suite shares ONE demo server — a single
  // PGLite review plus a single GLASSBOX_CONFIG_DIR — across every worker, so
  // parallel workers race on shared state: timing-sensitive image-feedback drag
  // tests get starved of mouse-event frames under CPU contention (region move
  // produces 0 / partial movement), and theme tests race each other on the
  // shared config dir (one test deleting a custom theme while another reads the
  // theme list → a mid-read 404 that the failOnPageError fixture turns into a
  // failure). Those flakes showed up only on the slower CI runners (consistently
  // on Windows, intermittently on Linux, never locally). Locally we keep
  // Playwright's default parallelism for speed; `CI` is set by GitHub Actions
  // (and by `test-e2e-docker.sh` for a faithful local repro).
  workers: process.env.CI ? 1 : undefined,
  // `list` keeps the human-readable console output; `html` writes a
  // self-contained report to `playwright-report/` (with embedded traces) that
  // the E2E CI jobs upload on failure. `open: 'never'` stops the HTML reporter
  // from trying to launch a browser at the end of a failed CI run (which would
  // hang the job).
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4183',
    headless: true,
    channel,
    viewport: { width: 1280, height: 720 },
    // Capture a Playwright trace when a test fails its first attempt and is
    // retried. The trace bundles the network log, console, and DOM snapshots,
    // so a CI-only failure (e.g. a 404 whose URL the bare console message
    // omits, or a flaky drag) can be diagnosed from the uploaded artifact
    // without reproducing the exact runner environment. The E2E CI jobs upload
    // `playwright-report/` + `test-results/` on failure.
    trace: 'on-first-retry',
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
      // Redirect ~/.glassbox to a disposable dir so settings tests never touch
      // the developer's real global config (GB-923). Playwright merges this over
      // the inherited process.env, so only the override is needed here.
      env: { GLASSBOX_CONFIG_DIR: DEMO_CONFIG_DIR },
    },
    {
      // Direct-comparison E2E server (doc 18). Boots `--diff` against the
      // checked-in fixture folders under `tests/fixtures/diff/{old,new}` and
      // anchors its `.glassbox/` data + export under a pid-scoped tmpdir so
      // each playwright run starts from a clean slate. `DIFF_WORK_DIR` is
      // created at config-eval time (above) so the command is just the server.
      command: `npx tsx src/cli.ts --diff tests/fixtures/diff/old tests/fixtures/diff/new --no-open --strict-port --port 4184 --data-dir ${JSON.stringify(join(DIFF_WORK_DIR, '.glassbox'))} --project-dir ${JSON.stringify(DIFF_WORK_DIR)}`,
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
