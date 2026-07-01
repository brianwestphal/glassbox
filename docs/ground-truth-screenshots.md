# Ground-Truth Screenshot Regression

A reproducible visual-regression suite for Glassbox's own UI. It captures one
PNG per "scene" (a feature area driven into a specific state), and compares this
version's screenshots against committed baselines — **using Glassbox's own
ground-truth comparison feature** (doc 26) as the review surface. When the UI
changes intentionally, the changed screenshots are **promoted** to become the
new baselines.

This dogfoods doc 26 end-to-end: the captured images are the "actual", the
committed images are the "expected", and `glassbox ground-truth promote` rotates
the baseline.

> **Status:** the harness, manifest, LFS wiring, npm scripts, the
> `glassbox-testing` fixture commits, and **47 scenes across every major feature
> area** are implemented in `scripts/ground-truth/scenes.ts` with committed
> baselines. A few genuinely-hard scenes (timing/drag/time-gated) remain as
> follow-ups (listed at the end). **This doc is the spec; keep it in lockstep
> with `scenes.ts`.**

---

## How it works

```
scripts/ground-truth/scenes.ts          # the scene registry (SSOT for what we capture)
scripts/ground-truth/capture-screenshots.ts   # boots Glassbox per scene, screenshots it
ground-truth-screenshots/
  manifest.json        # doc-26 manifest: actual ↔ expected per scene (committed)
  baseline/<slug>.png  # the committed "expected" images (Git LFS)
  actuals/<slug>.png   # freshly-captured "actual" images (gitignored, regenerated)
docs/ground-truth-screenshots.md         # this file — the human-readable spec
```

For each scene the capture harness:

1. Boots a real Glassbox server via `tsx src/cli.ts <scene args> --no-open
   --strict-port --ai-service-test --port <p> --data-dir <tmp>` inside the
   scene's repo, with an isolated `GLASSBOX_CONFIG_DIR`.
2. Opens it in Chromium (Playwright) at a fixed **1280×800 / scale 1** viewport.
3. Runs the scene's `setup(page)` to drive the UI into the pinned state.
4. Captures the viewport to `<slug>.png`.

It then (re)writes `manifest.json` from the full scene list so the ground-truth
review always covers every scene.

### The review + promote loop

```bash
# 1. Capture this version's screenshots into actuals/:
npm run gt:capture

# 2. Open the ground-truth review on the last-captured actuals (no re-capture):
npm run gt:review
#    → launches `glassbox --ground-truth ground-truth-screenshots/manifest.json`.
#    Each scene shows expected (baseline) vs actual with a perceptual-diff score;
#    identical pairs are hidden by default, most-changed first.
#
#    gt:capture and gt:review are deliberately SEPARATE: capture is a ~2-3 min
#    headless loop over every scene, so you (or an AI assistant) can capture +
#    triage once, then review as many times as you like without re-capturing.
#    Want both in one command? `npm run gt:capture-review`.

# 2b. If a change is a real regression → fix the code and re-run.
#    If a change is the new expected behavior → promote it:
npm run gt:promote
#    → copies the current actuals/ over baseline/ (only "previous-actual" entries,
#      which is every scene; a "spec" entry is never overwritten). Then commit the
#      updated baseline/ PNGs.
```

To regenerate **all** baselines from scratch (e.g. an intentional broad UI
change), capture straight into `baseline/`:

```bash
npm run gt:capture -- --baseline
```

Capture a subset with `--only`:

```bash
npm run gt:capture -- --only diff-code-split,diff-code-unified
```

### Triaging a diff: real change or noise?

For each changed scene, decide whether it's a **real UI change** (fix it, or
promote it as the new expected) or **capture noise** (ignore). Do not assume
"small score = noise" — that mistake once mislabeled the doc-28 A/B image-focus
segments as noise:

- **Cross-reference the baseline's age against the changelog first.** Get the
  baseline's capture date (`git log -1 -- ground-truth-screenshots/baseline/`),
  then scan `git log --since=<that date>` / `CHANGELOG.md` for UI-affecting commits
  (new controls, layout, themes). Those *predict* which scenes should genuinely
  differ. (The A/B image-focus control landed two days after a baseline and showed
  up in every two-sided `image-*` scene — foreseeable from the dates alone.)
- **A small perceptual score is not proof of noise.** The score is a fraction of
  changed pixels, so a real but *spatially small* change — e.g. two buttons added
  to a toolbar — scores well under 1%. Look at **where** the diff is, not just the
  magnitude: `magick compare -highlight-color red baseline/<s>.png actuals/<s>.png
  /tmp/<s>-diff.png`, or crop the changed region.
- **A determinism check must cover the scenes you're judging.** Capturing one scene
  twice and diffing run-to-run establishes the noise floor *for that scene only* —
  don't extrapolate a handful of scenes to the whole set.
- **Baselines are Git LFS objects.** `git show <ref>:.../baseline/<s>.png` returns
  the LFS *pointer* text (not a valid image); pipe it through `git lfs smudge` to
  get the historical bytes for a before/after comparison.

---

## Determinism & environment

A given **app version + pinned content** must produce a stable image, so:

- **Content is pinned.** Code/diff scenes launch `glassbox --commit <full-SHA>`;
  a commit's diff never changes, so the only variable is the app rendering it —
  which is exactly the regression we want to catch across versions.
- **AI is mocked** (`--ai-service-test`) — risk/narrative/guided content is
  deterministic mock data, and the API-key check is bypassed.
- **Config is isolated** (`GLASSBOX_CONFIG_DIR` + per-scene `--data-dir` tmp
  dirs) so no machine-specific settings or prior reviews leak in.
- **Fixed viewport** (1280×800, deviceScaleFactor 1).

**Cross-platform caveat:** PNGs still differ across OSes by font rendering and
sub-pixel anti-aliasing. The doc-26 perceptual diff is AA-tolerant, but for
trustworthy comparisons **generate baselines and run comparisons in a
consistent environment** — the maintainer's machine, or a pinned CI container.
Treat a baseline set as belonging to the environment that produced it.

---

## Content sources

| Source | Used for | Notes |
| --- | --- | --- |
| **This repo, pinned commit SHAs** | Code diffs, syntax highlighting, multi-file reviews, sidebar, navigation | A SHA's diff is immutable. Pin the **full** SHA in `scenes.ts`. |
| **Built-in demo scenarios** (`--demo:N`) | AI sort modes + notes, annotations, settings, completion modal, the binary image diff demo:4 seeds | Fully controlled, AI-mocked. See `src/demo.ts`. |
| **`glassbox-testing` repo** (`git@github.com:brianwestphal/glassbox-testing.git`) | Diff shapes this repo's history can't cleanly exercise — non-code files (md/json/yaml), binary non-image files, renames, large/long-line files, pure-add / pure-delete, and varied image-format diffs (PNG/JPEG/WebP/SVG) | A dedicated fixture repo so we can craft exact diffs **without committing throwaway content to glassbox**. The harness finds it via `GLASSBOX_TESTING_REPO` or a sibling `../glassbox-testing` checkout. Scenes pin its commit SHAs too. |
| **Repo-less `--ground-truth` / `--diff` fixtures** | Ground-truth mode itself, direct-comparison mode | Reuse / extend `tests/fixtures/ground-truth/` and `tests/fixtures/diff/`. |

---

## Scene catalog

Each row is one screenshot. **Slug** is the PNG / `scenes.ts` id; **Source** is
where the content comes from; **Steps** is the UI driving. All rows below are
implemented in `scenes.ts` with a committed baseline. The pinned `glassbox-testing`
fixture SHAs come from `build-testing-fixtures.sh` (deterministic, see below).

### Diff viewing (doc 4) — 10 scenes

| Slug | Source | Steps |
| --- | --- | --- |
| `diff-code-split` | self `899fd8d` | Open `src/client/sidebar/index.tsx`; default split view. |
| `diff-code-unified` | self `899fd8d` | Same file; switch to unified view. |
| `diff-scss` | self `899fd8d` | Open `_sidebar.scss` (SCSS highlighting). |
| `diff-context-expand` | self `899fd8d` | Open the `.tsx` file; click a hunk separator to expand context. |
| `diff-noncode` | testing (noncode) | Open `config/data.json` — a Markdown/JSON/YAML edit. |
| `diff-rename` | testing (rename) | Open `docs/new-name.md` — the rename badge. |
| `diff-added-only` | testing (add) | Open `app/helper.ts` — a brand-new file (additions only). |
| `diff-deleted-only` | testing (delete) | Open `legacy/deprecated.txt` — a deleted file. |
| `diff-long-line` | testing (longline) | Open `vendor/bundle.min.js` — a minified one-liner (truncation, GB-821). |
| `diff-binary` | testing (binary) | Select `data/blob.bin` — a non-image "Binary files differ". |

### Image diff (docs 4, 24) — 7 scenes

| Slug | Source | Steps |
| --- | --- | --- |
| `image-side-by-side` | demo:4 | Open the image; default side-by-side. |
| `image-over-under` | demo:4 | Side-by-side, over/under orientation. |
| `image-metadata` | demo:4 | Metadata mode. |
| `image-difference` | demo:4 | Difference mode. |
| `image-slice` | demo:4 | Slice mode. |
| `image-svg-rendered` | demo:4 | Open an SVG file (rendered view). |
| `image-png-swap` | testing (imageswap) | A real git-tracked PNG old→new diff (`assets/logo.png`). |

### Sidebar & AI sort modes (docs 7, 8) — 5 scenes

| Slug | Source | Steps |
| --- | --- | --- |
| `sidebar-folder` | demo:4 | Default folder grouping in the sidebar. |
| `sidebar-risk` | demo:2 | Risk sort with score badges on. |
| `sidebar-risk-popover` | demo:2 | Click a risk badge → the per-file risk-dimension popover. |
| `sidebar-narrative` | demo:3 | Narrative sort with position chips. |
| `sidebar-filter` | demo:4 | Type in the file filter. |

### AI notes (docs 7, 20) — 5 scenes

| Slug | Source | Steps |
| --- | --- | --- |
| `notes-guided` | demo:1 | Guided-review notes. |
| `notes-risk` | demo:2 | Inline risk notes. |
| `notes-narrative` | demo:3 | Narrative walkthrough notes. |
| `notes-review` | demo:7 | AI review notes (rationale/proof/risk + "outdated" badge). |
| `notes-reply` | demo:7 | A threaded human reply nested under a note. |

### Annotations (doc 5) — 2 scenes

| Slug | Source | Steps |
| --- | --- | --- |
| `annotations-categories` | demo:4 | Open `session.ts`; bug/fix/pattern annotation rows. |
| `annotations-form` | demo:4 | Click a diff line → the inline create form + category picker. |

### Settings & themes (docs 8, 15, 17, 22) — 12 scenes

| Slug | Source | Steps |
| --- | --- | --- |
| `settings-general` | demo:4 | Settings → General tab. |
| `settings-experimental` | demo:4 | Experimental tab — 5-platform AI picker, Claude Channel. |
| `settings-profile` | demo:4 | Profile tab. |
| `theme-manager` | demo:4 | Settings → Manage Themes → the theme manager dialog. |
| `theme-dark` | demo:4 | Main UI under the Dark (default) theme. |
| `theme-light` | demo:4 | Main UI under the Light theme. |
| `theme-dracula` | demo:4 | Main UI under the Dracula theme. |
| `theme-tokyo-night` | demo:4 | Main UI under the Tokyo Night theme. |
| `theme-high-contrast` | demo:4 | Main UI under High Contrast Dark. |
| `theme-solarized-dark` | demo:4 | Main UI under Solarized Dark. |
| `theme-monokai` | demo:4 | Main UI under Monokai. |
| `theme-one-dark-pro` | demo:4 | Main UI under One Dark Pro. |

### Ground-truth mode (doc 26) — dogfooding the feature itself — 4 scenes

| Slug | Source | Steps |
| --- | --- | --- |
| `gt-source-list` | `tests/fixtures/ground-truth` | Named source-list groups with difference-score + kind badges. |
| `gt-diff-header` | fixture | Open a comparison — Expected/Actual + step navigator. |
| `gt-difference` | fixture | Switch the comparison to difference mode. |
| `gt-identical-toggle` | fixture | Toggle "show identical" to reveal hidden 0-difference pairs. |

### Workflow & direct comparison (docs 1, 18) — 2 scenes

| Slug | Source | Steps |
| --- | --- | --- |
| `workflow-completion-modal` | demo:4 | Click "Complete Review" → the completion modal. |
| `direct-comparison` | `tests/fixtures/diff` | `--diff` of two folders (the `A ↔ B` label). |

### Deferred (follow-ups)

These need something more than a deterministic UI drive, so they're left for a
dedicated pass:

- `nav-go-to-definition` — a Cmd/Ctrl-click on a symbol with a resolvable definition.
- `workflow-share-prompt` — time-gated (5-min total / 1-min session thresholds);
  needs a way to force the prompt.
- `image-feedback-region` — drawing a region is a timing-sensitive mouse drag.
- `annotations-attachment` — needs a seeded attachment in the demo data.
- `theme-editor` — needs a custom (non-built-in) theme to edit.
- `gt-sets-steps` — the collapsible set group is already visible in
  `gt-source-list`; a dedicated collapsed-state capture adds little.

> **glassbox-testing fixtures.** The diff-shape scenes pin commits from the
> `glassbox-testing` repo, cloned to the gitignored `external/glassbox-testing/`
> and seeded by `scripts/ground-truth/build-testing-fixtures.sh`. That script
> uses **fixed commit dates**, so re-running it reproduces byte-identical commits
> (and therefore the same SHAs) — but the pinned SHAs reference the **pushed**
> history, so if you change a fixture you must re-run, `git push --force`, and
> re-pin the printed SHAs in `scenes.ts`.

---

## Maintenance contract

- **`scenes.ts` and this doc are one unit.** Adding a scene means: add it to
  `scenes.ts`, document its row here (slug / source / steps), and capture its
  baseline. Removing a scene means deleting all three (entry, row, and the
  `baseline/<slug>.png`).
- **Pin full SHAs.** Short SHAs drift; always pin the 40-char SHA in `scenes.ts`.
- **Baselines are environment-bound.** Regenerate them on the same environment
  you compare on (see the determinism note).
- **Promotion is explicit and human-reviewed.** Baselines change only via
  `glassbox ground-truth promote` (or `--baseline` capture) followed by a commit
  — never automatically.

See also: doc 26 (ground-truth comparison), `docs/proof-export-guidance.md`, and
`scripts/demo/capture-stills.ts` (the sibling marketing-screenshot capture this
harness is modeled on).
