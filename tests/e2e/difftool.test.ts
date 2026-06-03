import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from './coverage-fixture.js';

/**
 * Browser-driven coverage for the accumulating `git difftool` session (doc 19,
 * FR-19.3 / 19.7 / 19.8 / 19.5).
 *
 * The unit + integration suites cover the wrapper's pure decisions, server
 * discovery, and the append/poll/hold/end endpoints. What only a real browser
 * catches is the live wiring: files appended AFTER the page loaded must show up
 * in the sidebar without a reload, labeled with their repo-relative path, with
 * the first one auto-selected and its diff rendered — and the session-only
 * "Done" affordance must end the session and surface the closing overlay.
 *
 * A dedicated `glassbox --difftool-serve` server is spawned on port 4186 (outside
 * the playwright-managed demo:4183 / diff:4184 servers). The test drives it by
 * POSTing to the append endpoint exactly the way the per-file wrapper does.
 */

const PORT = 4186;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess;
let dataDir: string;

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/difftool/ping`);
      if (res.ok && ((await res.json()) as { active?: boolean }).active === true) return;
    } catch {
      /* server not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('difftool-serve server did not become ready in time');
}

/** Append one file the way the wrapper does: raw base64 old/new content. */
async function append(path: string, oldText: string, newText: string): Promise<void> {
  const res = await fetch(`${BASE}/api/difftool/append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      oldContentB64: Buffer.from(oldText).toString('base64'),
      newContentB64: Buffer.from(newText).toString('base64'),
    }),
  });
  if (!res.ok) throw new Error(`append ${path} failed: ${String(res.status)}`);
}

// A minimal valid 1×1 PNG, appended as an added binary file (empty old side).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

/** Append a binary image and return its server-assigned fileId. */
async function appendImage(path: string): Promise<string> {
  const res = await fetch(`${BASE}/api/difftool/append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, oldContentB64: '', newContentB64: PNG_1X1.toString('base64') }),
  });
  if (!res.ok) throw new Error(`append image failed: ${String(res.status)}`);
  return (await res.json() as { fileId: string }).fileId;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'gb-difftool-e2e-'));
  // `npx` is `npx.cmd` on Windows; Node's `spawn` without a shell can't resolve
  // the bare name, so pick the platform binary.
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  server = spawn(
    npx,
    ['tsx', 'src/cli.ts', '--difftool-serve', '--no-open', '--strict-port', '--port', String(PORT), '--data-dir', dataDir],
    { stdio: 'ignore', env: { ...process.env } },
  );
  // Generous ceiling: the `--difftool-serve` server (PGLite init + review
  // create) can take >30s to answer on a slow/constrained machine. This is just
  // an upper bound — it resolves as soon as the server is ready.
  await waitForReady(60_000);
});

test.afterAll(() => {
  try { server.kill('SIGKILL'); } catch { /* already gone (Done test exits it) */ }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// One test drives the whole lifecycle on a single page. Splitting it would let
// the first page's `beforeunload` end-of-session beacon tear the shared server
// down before the next test runs.
test('accumulates appended files live, then "Done" ends the session (doc 19)', async ({ page }) => {
  await page.goto(`${BASE}/`);
  // The session-only "Done" affordance renders for a difftool review (FR-19.5).
  await expect(page.locator('#difftool-done')).toBeVisible();

  // Simulate the per-file wrapper handing four files into the live review (three
  // text + one binary image). Append de-dupes by path, so this is idempotent
  // across a test retry.
  await append('src/alpha.ts', 'const a = 1;\n', 'const a = 2;\n');
  await append('src/beta.ts', '', 'export const beta = true;\n');
  await append('README.md', '# Old\n', '# New\n');
  const imageFileId = await appendImage('assets/icon.png');

  // FR-19.8 — the sidebar grows live (polling, no reload), and each file is
  // labeled with its full repo-relative path (GB-864), not a bare basename.
  await expect(page.locator('.file-item')).toHaveCount(4, { timeout: 5_000 });
  await expect(page.locator('.file-name[title="src/alpha.ts"]')).toHaveCount(1);
  await expect(page.locator('.file-name[title="src/beta.ts"]')).toHaveCount(1);
  await expect(page.locator('.file-name[title="README.md"]')).toHaveCount(1);
  await expect(page.locator('.file-name[title="assets/icon.png"]')).toHaveCount(1);

  // The first file auto-selects and its diff renders (the append-produced
  // FileDiff flows through the normal diff view).
  await expect(page.locator('#diff-container')).not.toBeEmpty({ timeout: 5_000 });

  // GB-863 — the image route serves the appended binary from the on-disk blob
  // store (a difftool session has no git refs / working tree to re-read).
  const img = await page.request.get(`${BASE}/api/image/${imageFileId}/new`);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toBe('image/png');
  expect(Buffer.from(await img.body())).toEqual(PNG_1X1);

  // FR-19.5 — "Done" ends the session: the client clears its poll timer and
  // shows a terminal overlay, then the detached server exits on its own.
  await page.locator('#difftool-done').click();
  await expect(page.locator('#difftool-ended-overlay')).toBeVisible({ timeout: 5_000 });
});
