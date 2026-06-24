/**
 * The ground-truth screenshot scene registry — the single source of truth for
 * what the regression suite captures. Each scene boots Glassbox in a specific
 * launch mode, drives the UI into a state worth pinning, and is screenshotted to
 * one PNG. `docs/ground-truth-screenshots.md` documents each scene in prose and
 * MUST be kept in lockstep with this list (add a scene here → document it there).
 *
 * Determinism: every scene runs with `--ai-service-test` (mock AI), an isolated
 * `GLASSBOX_CONFIG_DIR` + `--data-dir`, and a fixed viewport, so a given app
 * version + pinned content produces a stable image. Content comes from PINNED
 * commit SHAs (a SHA's diff never changes) in this repo, the separate
 * `glassbox-testing` repo (for diff shapes this repo's history can't exercise),
 * or the built-in `--demo:N` scenarios for demo-only views.
 */
import type { Page } from '@playwright/test';

/** Which checked-out repo a scene's Glassbox launch runs inside. */
export type SceneRepo = 'self' | 'glassbox-testing';

export interface Scene {
  /** Output filename base → `baseline/<slug>.png` (committed) / `actuals/<slug>.png`. */
  slug: string;
  /** Human-readable label shown in logs + the ground-truth review list. */
  label: string;
  /** The feature area this scene exercises (for the doc + grouping). */
  featureArea: string;
  /** Which repo to launch Glassbox inside (`self` = this glassbox checkout). */
  repo: SceneRepo;
  /** CLI args for the Glassbox launch (mode-defining flags only; the harness
   *  adds `--no-open --strict-port --ai-service-test --port <p>` + isolation). */
  args: string[];
  /** Drive the page into the state worth screenshotting after the home page loads. */
  setup: (page: Page, base: string) => Promise<void>;
}

// --- Pinned content (full SHAs — a commit's diff is immutable) ---------------

/** This repo: a focused 6-file feature commit (the nav-bar sidebar toggle,
 *  GB-955) — TypeScript + SCSS + TSX, a clean code diff. */
const SELF_CODE = '899fd8d3d69b539d9321708e01b6d12c2802c759';

/** glassbox-testing fixture commits — deterministic SHAs from
 *  scripts/ground-truth/build-testing-fixtures.sh (fixed dates → stable SHAs).
 *  T_SEED is the ROOT commit (no parent) so it can't be `--commit`-diffed; the
 *  pure-addition scene uses T_ADDED instead. */
const T_ADDED = 'a415c84f44393fa6d33dc90ea0c88f310c6da9c7';    // new file (pure add)
const T_NONCODE = '955c3de07477db20bbf1ffd59a32a7b44956cabd';  // md + json + yaml edits
const T_RENAME = '246fdcc11b70d20e9f8ade66669cffb8268e1fba';   // file rename
const T_DELETE = '46b1f9243509062128127a8e5666c19cae20376f';   // file delete
const T_LONGLINE = 'a1fe562f8553fc8bc55368afe33de3995a3fda76'; // minified one-liner
const T_BINARY = 'ac6dc3793f19c65cbab26459b198256db8e04c05';   // binary (non-image) blob
const T_IMAGESWAP = 'adbe21c337f769d80daceb009e782ffcf774a431'; // PNG old → new

// --- Demo content paths ------------------------------------------------------

const DEMO_FILE = 'src/auth/session.ts';
const DEMO_IMAGE = 'src-tauri/icons/128x128.png';
const DEMO_SVG = 'tests/fixtures/diff/new/icon.svg';
const GT_MANIFEST = 'tests/fixtures/ground-truth/manifest.json';
const DIFF_OLD = 'tests/fixtures/diff/old';
const DIFF_NEW = 'tests/fixtures/diff/new';

// --- UI driving helpers ------------------------------------------------------

/** Open a code/text file and wait for its diff to render. Retries the click
 *  once — the file row occasionally isn't hit-testable the instant the folder
 *  tree finishes rendering under repeated-launch load. */
async function openFile(page: Page, path: string): Promise<void> {
  const sel = `.file-name[title="${path}"]`;
  await page.waitForSelector(sel, { state: 'visible', timeout: 20000 });
  try {
    await page.click(sel, { timeout: 8000 });
  } catch {
    await page.click(sel, { timeout: 8000 });
  }
  await page.waitForSelector(`.diff-view[data-file-path="${path}"]`, { timeout: 15000 });
  await page.waitForTimeout(600);
}

/** Select a file and wait for the diff container to settle, without requiring a
 *  text `.diff-view` (binary placeholders / image views don't render one). */
async function selectFileLoose(page: Page, path: string): Promise<void> {
  await page.click(`.file-name[title="${path}"]`);
  await page.waitForTimeout(1200);
}

/** Open an image file and wait for the image-diff view. */
async function openImage(page: Page, path: string): Promise<void> {
  await page.click(`.file-name[title="${path}"]`);
  await page.waitForSelector('.image-diff', { timeout: 15000 });
  await page.waitForTimeout(800);
}

/** Set the active theme via the API, then reload so the whole UI re-renders. */
async function setTheme(page: Page, base: string, id: string): Promise<void> {
  await fetch(`${base}/api/themes/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  await page.reload({ waitUntil: 'networkidle' });
}

export const SCENES: Scene[] = [
  // ============================ Diff viewing (doc 4) ========================
  {
    slug: 'diff-code-split', label: 'Code diff — split view', featureArea: 'Diff viewing',
    repo: 'self', args: ['--commit', SELF_CODE],
    async setup(page) { await openFile(page, 'src/client/sidebar/index.tsx'); },
  },
  {
    slug: 'diff-code-unified', label: 'Code diff — unified view', featureArea: 'Diff viewing',
    repo: 'self', args: ['--commit', SELF_CODE],
    async setup(page) {
      await openFile(page, 'src/client/sidebar/index.tsx');
      await page.click('[data-diff-mode="unified"]');
      await page.waitForSelector('.diff-table-unified', { timeout: 10000 });
      await page.waitForTimeout(600);
    },
  },
  {
    slug: 'diff-scss', label: 'SCSS diff (different highlighting)', featureArea: 'Diff viewing',
    repo: 'self', args: ['--commit', SELF_CODE],
    async setup(page) { await openFile(page, 'src/client/styles/_sidebar.scss'); },
  },
  {
    slug: 'diff-context-expand', label: 'Context expansion', featureArea: 'Diff viewing',
    repo: 'self', args: ['--commit', SELF_CODE],
    async setup(page) {
      await openFile(page, 'src/client/sidebar/index.tsx');
      // Expand the surrounding context at the first hunk boundary.
      const sep = page.locator('.hunk-separator[data-hunk-idx]').first();
      if (await sep.count() > 0) { await sep.click().catch(() => undefined); }
      await page.waitForTimeout(800);
    },
  },
  {
    slug: 'diff-noncode', label: 'Non-code diff (Markdown/JSON/YAML)', featureArea: 'Diff viewing',
    repo: 'glassbox-testing', args: ['--commit', T_NONCODE],
    async setup(page) { await openFile(page, 'config/data.json'); },
  },
  {
    slug: 'diff-rename', label: 'File rename', featureArea: 'Diff viewing',
    repo: 'glassbox-testing', args: ['--commit', T_RENAME],
    async setup(page) { await openFile(page, 'docs/new-name.md'); },
  },
  {
    slug: 'diff-added-only', label: 'New file (additions only)', featureArea: 'Diff viewing',
    repo: 'glassbox-testing', args: ['--commit', T_ADDED],
    async setup(page) { await openFile(page, 'app/helper.ts'); },
  },
  {
    slug: 'diff-deleted-only', label: 'Deleted file', featureArea: 'Diff viewing',
    repo: 'glassbox-testing', args: ['--commit', T_DELETE],
    async setup(page) { await openFile(page, 'legacy/deprecated.txt'); },
  },
  {
    slug: 'diff-long-line', label: 'Minified long-line file (truncation)', featureArea: 'Diff viewing',
    repo: 'glassbox-testing', args: ['--commit', T_LONGLINE],
    async setup(page) { await openFile(page, 'vendor/bundle.min.js'); },
  },
  {
    slug: 'diff-binary', label: 'Binary (non-image) file', featureArea: 'Diff viewing',
    repo: 'glassbox-testing', args: ['--commit', T_BINARY],
    async setup(page) { await selectFileLoose(page, 'data/blob.bin'); },
  },

  // ============================ Image diff (docs 4, 24) ====================
  {
    slug: 'image-side-by-side', label: 'Image — side by side', featureArea: 'Image diff',
    repo: 'self', args: ['--demo:4'],
    async setup(page) { await openImage(page, DEMO_IMAGE); },
  },
  {
    slug: 'image-over-under', label: 'Image — side by side (over/under)', featureArea: 'Image diff',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await openImage(page, DEMO_IMAGE);
      const btn = page.locator('[data-sxs-orient="over-under"]');
      if (await btn.count() > 0) { await btn.first().click().catch(() => undefined); }
      await page.waitForTimeout(700);
    },
  },
  {
    slug: 'image-metadata', label: 'Image — metadata mode', featureArea: 'Image diff',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await openImage(page, DEMO_IMAGE);
      await page.click('[data-image-mode="metadata"]');
      await page.waitForTimeout(700);
    },
  },
  {
    slug: 'image-difference', label: 'Image — difference mode', featureArea: 'Image diff',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await openImage(page, DEMO_IMAGE);
      await page.click('[data-image-mode="difference"]');
      await page.waitForTimeout(700);
    },
  },
  {
    slug: 'image-slice', label: 'Image — slice mode', featureArea: 'Image diff',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await openImage(page, DEMO_IMAGE);
      await page.click('[data-image-mode="slice"]');
      await page.waitForTimeout(700);
    },
  },
  {
    slug: 'image-svg-rendered', label: 'SVG rendered view', featureArea: 'Image diff',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await page.click(`.file-name[title="${DEMO_SVG}"]`);
      await page.waitForTimeout(1200);
    },
  },
  {
    slug: 'image-png-swap', label: 'Git-tracked PNG diff (old → new)', featureArea: 'Image diff',
    repo: 'glassbox-testing', args: ['--commit', T_IMAGESWAP],
    async setup(page) { await openImage(page, 'assets/logo.png'); },
  },

  // ===================== Sidebar & AI sort modes (docs 7, 8) ===============
  {
    slug: 'sidebar-risk', label: 'Risk sort with score badges', featureArea: 'Sidebar / sort',
    repo: 'self', args: ['--demo:2'],
    async setup(page, base) {
      await fetch(`${base}/api/ai/preferences`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_risk_scores: true, risk_sort_dimension: 'aggregate' }),
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.risk-badge', { timeout: 12000 });
      await page.waitForTimeout(600);
    },
  },
  {
    slug: 'sidebar-narrative', label: 'Narrative sort with position chips', featureArea: 'Sidebar / sort',
    repo: 'self', args: ['--demo:3'],
    async setup(page) {
      await page.waitForSelector('.narrative-position', { timeout: 12000 });
      await page.waitForTimeout(600);
    },
  },
  {
    slug: 'sidebar-filter', label: 'File filter', featureArea: 'Sidebar / sort',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await page.fill('#file-filter', 'session');
      await page.waitForTimeout(500);
    },
  },

  // ============================ AI notes (docs 7, 20) ======================
  {
    slug: 'notes-guided', label: 'Guided review notes', featureArea: 'AI notes',
    repo: 'self', args: ['--demo:1'],
    async setup(page) {
      await page.waitForTimeout(4500);
      await openFile(page, DEMO_FILE);
      await page.waitForSelector('.ai-note-guided', { timeout: 10000 }).catch(() => undefined);
    },
  },
  {
    slug: 'notes-risk', label: 'Inline risk notes', featureArea: 'AI notes',
    repo: 'self', args: ['--demo:2'],
    async setup(page) {
      await openFile(page, DEMO_FILE);
      await page.waitForSelector('.ai-note-risk', { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'notes-narrative', label: 'Narrative walkthrough notes', featureArea: 'AI notes',
    repo: 'self', args: ['--demo:3'],
    async setup(page) {
      await openFile(page, DEMO_FILE);
      await page.waitForSelector('.ai-note-narrative', { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'notes-review', label: 'AI review notes (with outdated badge)', featureArea: 'AI notes',
    repo: 'self', args: ['--demo:7'],
    async setup(page) {
      await openFile(page, DEMO_FILE);
      await page.waitForSelector('.ai-note-review', { timeout: 10000 });
      await page.waitForTimeout(400);
    },
  },

  // ============================ Annotations (doc 5) ========================
  {
    slug: 'annotations-categories', label: 'Line annotations with categories', featureArea: 'Annotations',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await openFile(page, DEMO_FILE);
      await page.waitForSelector('.annotation-row', { timeout: 15000 });
      await page.waitForTimeout(400);
    },
  },

  // ===================== Settings & themes (docs 8, 15, 17, 22) ============
  {
    slug: 'settings-general', label: 'Settings — General tab', featureArea: 'Settings',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await page.click('.settings-gear');
      await page.waitForSelector('.settings-dialog', { timeout: 5000 });
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'settings-experimental', label: 'Settings — Experimental (AI platforms)', featureArea: 'Settings',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await page.click('.settings-gear');
      await page.waitForSelector('.settings-dialog', { timeout: 5000 });
      await page.click('[data-tab="experimental"]');
      await page.waitForSelector('[data-panel="experimental"].active', { timeout: 4000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'settings-profile', label: 'Settings — Profile tab', featureArea: 'Settings',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await page.click('.settings-gear');
      await page.waitForSelector('.settings-dialog', { timeout: 5000 });
      await page.click('[data-tab="profile"]');
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'theme-dracula', label: 'Main UI — Dracula theme', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page, base) {
      await setTheme(page, base, 'dracula');
      await openFile(page, DEMO_FILE);
    },
  },
  {
    slug: 'theme-light', label: 'Main UI — Light theme', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page, base) {
      await setTheme(page, base, 'light');
      await openFile(page, DEMO_FILE);
    },
  },
  {
    slug: 'theme-tokyo-night', label: 'Main UI — Tokyo Night theme', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page, base) {
      await setTheme(page, base, 'tokyo-night');
      await openFile(page, DEMO_FILE);
    },
  },

  // ============= Ground-truth mode itself (doc 26) — dogfooding ============
  {
    slug: 'gt-source-list', label: 'Ground-truth source list', featureArea: 'Ground-truth mode',
    repo: 'self', args: ['--ground-truth', GT_MANIFEST],
    async setup(page) { await page.waitForTimeout(1500); },
  },
  {
    slug: 'gt-diff-header', label: 'Ground-truth Expected/Actual header + step nav', featureArea: 'Ground-truth mode',
    repo: 'self', args: ['--ground-truth', GT_MANIFEST],
    async setup(page) {
      // Open the first comparison in the source list.
      const first = page.locator('.file-item').first();
      await first.click();
      await page.waitForSelector('.image-diff', { timeout: 12000 }).catch(() => undefined);
      await page.waitForTimeout(900);
    },
  },
  {
    slug: 'gt-difference', label: 'Ground-truth perceptual difference', featureArea: 'Ground-truth mode',
    repo: 'self', args: ['--ground-truth', GT_MANIFEST],
    async setup(page) {
      await page.locator('.file-item').first().click();
      await page.waitForSelector('.image-diff', { timeout: 12000 }).catch(() => undefined);
      const btn = page.locator('[data-image-mode="difference"]');
      if (await btn.count() > 0) { await btn.first().click().catch(() => undefined); }
      await page.waitForTimeout(800);
    },
  },

  // ===================== Workflow & direct comparison (docs 1, 18) =========
  {
    slug: 'workflow-completion-modal', label: 'Review completion modal', featureArea: 'Workflow',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await page.click('#complete-review');
      await page.waitForSelector('.modal-overlay', { timeout: 5000 });
      await page.waitForTimeout(500);
    },
  },
  {
    slug: 'direct-comparison', label: 'Direct comparison (--diff)', featureArea: 'Direct comparison',
    repo: 'self', args: ['--diff', DIFF_OLD, DIFF_NEW],
    async setup(page) {
      const first = page.locator('.file-item').first();
      await first.click();
      await page.waitForTimeout(1200);
    },
  },

  // ============== GB-996 follow-up: finer-grained scenes ==================
  {
    slug: 'sidebar-folder', label: 'Folder grouping (sidebar)', featureArea: 'Sidebar / sort',
    repo: 'self', args: ['--demo:4'],
    async setup(page) { await page.waitForTimeout(1200); },
  },
  {
    slug: 'sidebar-risk-popover', label: 'Per-file risk dimension popover', featureArea: 'Sidebar / sort',
    repo: 'self', args: ['--demo:2'],
    async setup(page, base) {
      await fetch(`${base}/api/ai/preferences`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_risk_scores: true, risk_sort_dimension: 'aggregate' }),
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.risk-badge', { timeout: 12000 });
      await page.locator('.risk-badge').first().click();
      await page.waitForSelector('.risk-popover', { timeout: 5000 });
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'notes-reply', label: 'Threaded reply under an AI note', featureArea: 'AI notes',
    repo: 'self', args: ['--demo:7'],
    async setup(page) {
      await openFile(page, DEMO_FILE);
      await page.waitForSelector('.annotation-reply-tag', { timeout: 10000 });
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'annotations-form', label: 'Annotation create form', featureArea: 'Annotations',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await openFile(page, DEMO_FILE);
      await page.locator('.diff-line').first().click();
      await page.waitForSelector('.annotation-form-container', { timeout: 6000 });
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'theme-manager', label: 'Theme manager', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page) {
      await page.click('.settings-gear');
      await page.waitForSelector('.settings-dialog', { timeout: 5000 });
      await page.click('#manage-themes-btn');
      await page.waitForSelector('.theme-manager-dialog', { timeout: 5000 });
      await page.waitForTimeout(400);
    },
  },
  {
    slug: 'theme-dark', label: 'Main UI — Dark theme (default)', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page, base) { await setTheme(page, base, 'dark'); await openFile(page, DEMO_FILE); },
  },
  {
    slug: 'theme-high-contrast', label: 'Main UI — High Contrast Dark theme', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page, base) { await setTheme(page, base, 'high-contrast-dark'); await openFile(page, DEMO_FILE); },
  },
  {
    slug: 'theme-solarized-dark', label: 'Main UI — Solarized Dark theme', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page, base) { await setTheme(page, base, 'solarized-dark'); await openFile(page, DEMO_FILE); },
  },
  {
    slug: 'theme-monokai', label: 'Main UI — Monokai theme', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page, base) { await setTheme(page, base, 'monokai'); await openFile(page, DEMO_FILE); },
  },
  {
    slug: 'theme-one-dark-pro', label: 'Main UI — One Dark Pro theme', featureArea: 'Themes',
    repo: 'self', args: ['--demo:4'],
    async setup(page, base) { await setTheme(page, base, 'one-dark-pro'); await openFile(page, DEMO_FILE); },
  },
  {
    slug: 'gt-identical-toggle', label: 'Ground-truth — show identical toggle', featureArea: 'Ground-truth mode',
    repo: 'self', args: ['--ground-truth', GT_MANIFEST],
    async setup(page) {
      await page.waitForSelector('.identical-toggle', { timeout: 10000 });
      await page.locator('.identical-toggle').first().click();
      await page.waitForTimeout(600);
    },
  },
];
