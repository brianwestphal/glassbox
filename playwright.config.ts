import { cpSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { defineConfig } from '@playwright/test';

// The `--diff` E2E project (doc 18) needs an isolated cwd/data-dir so the
// `.glassbox/` artifacts it writes don't collide with the demo run or the
// developer's real Glassbox state. A pid-scoped tmpdir gives each playwright
// invocation a fresh review.
const DIFF_WORK_DIR = join(tmpdir(), `glassbox-e2e-diff-${process.pid}`);

// The ground-truth E2E project (doc 26) likewise needs an isolated cwd/data-dir
// so its `.glassbox/` artifacts don't collide with the other servers.
const GT_WORK_DIR = join(tmpdir(), `glassbox-e2e-gt-${process.pid}`);

// Isolate the demo server's GLOBAL config (`~/.glassbox/config.json` + custom
// themes) under a disposable pid-scoped dir via GLASSBOX_CONFIG_DIR (GB-923).
// Without this the suite reads/writes the developer's real `~/.glassbox`, so
// the settings tests silently overwrite their AI platform/keys and the
// local-platform test becomes machine-dependent (failing when the real config
// already selects `local`). A fresh empty dir also gives every run a
// deterministic default platform (`anthropic`).
const DEMO_CONFIG_DIR = join(tmpdir(), `glassbox-e2e-config-${process.pid}`);

// The content-plugin E2E project (doc 29, GB-1043) boots its own `--diff` server
// against a `.fdiag` pair with a fixture content plugin pre-installed in an
// isolated GLASSBOX_CONFIG_DIR — so the file-diff render path (a plugin-rendered
// file → the Code|Rendered toggle → an SVG in the image viewer) is exercised
// end-to-end with a real installed plugin, not just unit-tested.
const PLUGIN_WORK_DIR = join(tmpdir(), `glassbox-e2e-plugin-${process.pid}`);
const PLUGIN_CONFIG_DIR = join(tmpdir(), `glassbox-e2e-plugin-config-${process.pid}`);

// Create the work dirs here (config eval runs before the webServers) rather than
// via a shell `mkdir -p` in the webServer command — the CLI chdirs into
// `--project-dir` before creating anything itself, so the dir must exist first.
// Doing it in Node keeps it cross-platform (`mkdir -p` isn't valid on Windows
// `cmd`, where it spuriously creates a `-p` dir and then errors on reruns).
mkdirSync(DIFF_WORK_DIR, { recursive: true });
mkdirSync(GT_WORK_DIR, { recursive: true });
mkdirSync(DEMO_CONFIG_DIR, { recursive: true });
mkdirSync(PLUGIN_WORK_DIR, { recursive: true });

// Seed the plugin server's project dir with a committed `.pr-notes/` review note
// anchored to `diagram.fdiag` plus its `.fdiag` proof artifact, so the review-note
// **artifact** render path (doc 29 FR-29.2, the other integration point) is also
// exercised: the fixture plugin renders the artifact to an inline inert SVG.
cpSync(join(process.cwd(), 'tests/fixtures/plugin-diff-notes'), PLUGIN_WORK_DIR, { recursive: true });

// Pre-install the fixture content plugin into the plugin server's isolated
// GLASSBOX_CONFIG_DIR before it boots. Discovery loads it from `<config>/plugins/`
// exactly like a real installed plugin (GB-1043).
mkdirSync(join(PLUGIN_CONFIG_DIR, 'plugins'), { recursive: true });
cpSync(
  join(process.cwd(), 'tests/fixtures/plugin/fixture-diagram'),
  join(PLUGIN_CONFIG_DIR, 'plugins', 'fixture-diagram'),
  { recursive: true },
);

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
  // Run serially everywhere (GB-994). The whole suite shares ONE demo server —
  // a single PGLite review plus a single GLASSBOX_CONFIG_DIR — across every
  // worker, so parallel workers race on shared state: timing-sensitive
  // image-feedback drag tests get starved of mouse-event frames under CPU
  // contention (region move produces 0 / partial movement); theme tests race
  // each other on the shared config dir (one test deleting a custom theme while
  // another reads the theme list → a mid-read 404 that the failOnPageError
  // fixture turns into a failure); and any spec asserting absolute pre-existing
  // demo state (file review status, persisted sort_mode, the seeded annotations
  // / review notes) can be raced by a sibling spec mutating that same review.
  // CI was already serial (consistently flaky on Windows, intermittently on
  // Linux); we now match it locally too, trading ~30-60s of wall-clock for a
  // deterministic run — the suite is ~1 min and determinism beats the margin.
  // The isolated `--diff` / `--ground-truth` projects (their own pid-scoped
  // servers) don't share state, but `workers` is global, so they ride along.
  workers: 1,
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
  webServer: [
    // Under SKIP_WEBSERVER (set by scripts/test-e2e-coverage.sh, which starts
    // the MAIN 4183 server itself so it can collect the server's V8 coverage on
    // clean exit), only this first entry is dropped — the auxiliary per-project
    // servers below must still start or every chromium-diff / chromium-ground-
    // truth / chromium-plugin test fails with ERR_CONNECTION_REFUSED.
    ...(process.env.SKIP_WEBSERVER ? [] : [{
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
    }]),
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
    {
      // Ground-truth E2E server (doc 26). Boots `--ground-truth` against the
      // checked-in manifest under `tests/fixtures/ground-truth/` and anchors its
      // `.glassbox/` data + export under a pid-scoped tmpdir.
      command: `npx tsx src/cli.ts --ground-truth tests/fixtures/ground-truth/manifest.json --no-open --strict-port --port 4185 --data-dir ${JSON.stringify(join(GT_WORK_DIR, '.glassbox'))} --project-dir ${JSON.stringify(GT_WORK_DIR)}`,
      port: 4185,
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      // Content-plugin E2E server (doc 29, GB-1043). Boots `--diff` against the
      // checked-in `.fdiag` pair with the fixture content plugin pre-installed in
      // PLUGIN_CONFIG_DIR (copied above), so the file-diff render path renders the
      // plugin's SVG. Isolated `--data-dir`/`--project-dir` + its own config dir.
      command: `npx tsx src/cli.ts --diff tests/fixtures/plugin-diff/old tests/fixtures/plugin-diff/new --no-open --strict-port --port 4187 --data-dir ${JSON.stringify(join(PLUGIN_WORK_DIR, '.glassbox'))} --project-dir ${JSON.stringify(PLUGIN_WORK_DIR)}`,
      // Port 4187: 4186 is taken by the difftool test's own spawned server.
      port: 4187,
      reuseExistingServer: false,
      timeout: 15000,
      // GLASSBOX_BUNDLED_PLUGINS_DIR points the "available to install" list (GB-1069)
      // at a fixture bundle holding one self-contained opt-in plugin, so the
      // management-tab e2e (GB-1070) can drive the install flow deterministically.
      env: {
        GLASSBOX_CONFIG_DIR: PLUGIN_CONFIG_DIR,
        GLASSBOX_BUNDLED_PLUGINS_DIR: join(process.cwd(), 'tests/fixtures/plugin-bundle'),
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: [/diff-mode\.test\.ts$/, /ground-truth\.test\.ts$/, /plugin-render\.test\.ts$/, /plugin-manage\.test\.ts$/],
      use: { browserName: 'chromium' },
    },
    {
      name: 'chromium-diff',
      testMatch: /diff-mode\.test\.ts$/,
      use: { browserName: 'chromium', baseURL: 'http://localhost:4184' },
    },
    {
      name: 'chromium-ground-truth',
      testMatch: /ground-truth\.test\.ts$/,
      use: { browserName: 'chromium', baseURL: 'http://localhost:4185' },
    },
    {
      name: 'chromium-plugin',
      testMatch: /plugin-(render|manage)\.test\.ts$/,
      use: { browserName: 'chromium', baseURL: 'http://localhost:4187' },
    },
  ],
});
