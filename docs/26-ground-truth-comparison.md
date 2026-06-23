# 26. Ground-Truth Image Comparison

> **Status: P1 + P2 shipped** (manifest + single-image actual-vs-expected mode;
> perceptual diff + identical-filtering + difference-score triage). Sets/flows +
> capture pipeline (P3) remain design-only; see "Phasing".

Glassbox's image comparison (doc [4](4-diff-viewing.md) §4.3, doc
[24](24-image-comparison-layouts.md)) compares an image's **old vs new** sides
from git history. This feature adds a separate comparison axis: compare an
**actual** image against an **expected** ("ground truth") image — a design spec,
a reference render, or a previously-captured baseline — even when the expected
image lives **outside** the repository.

It is inspired by the review tooling around [`domotion`](https://github.com/brianwestphal/domotion)
(a DOM-to-animated-SVG renderer), where captured screenshots / flows are checked
against design references.

## 26.1 What it is

- **FR-26.1 — A distinct mode.** Ground-truth comparison is a separate Glassbox
  mode/tool, not a variant of the git old/new diff. The left ("source") side
  stays glassbox-like (a list of the things under review); the right side reuses
  the **same image comparison modes** (difference / slice / side-by-side, doc 24)
  and **rectangle region selection** (doc [23](23-image-feedback.md)) that the
  version-diff image view already provides.
- **FR-26.2 — Actual vs expected.** Each item under review pairs an **actual**
  image with an **expected** image. The comparison shows them with the existing
  overlay/slice/side-by-side modes and lets the reviewer annotate regions.
- **FR-26.3 — Previous-actual baseline.** Instead of a formal expected/spec
  image, the reviewer can compare the **current actual** against the **previous
  actual** (the last captured version), as a regression check. This is the same
  comparison UI with a different "expected" source.

## 26.2 Source of the expected images — a manifest

- **FR-26.4 — Manifest-driven mapping.** The actual→expected pairing is declared
  in a **manifest** (chosen design), not inferred only from paths. The manifest
  maps each actual image to its expected image (and, later, actual *sets* to
  expected *sets* for flows). This handles renamed files, expecteds that live
  outside the repo, and multi-step flows that a folder convention can't express.
  - **Shipped format (P1).** A JSON file with `version: 1` and a `comparisons`
    array; each entry has `actual` + `expected` paths and optional `label` +
    `expectedKind` (`spec` | `reference` | `previous-actual`):

    ```json
    {
      "version": 1,
      "comparisons": [
        { "actual": "out/login.png", "expected": "design/login.png",
          "label": "Login screen", "expectedKind": "spec" }
      ]
    }
    ```

    Paths resolve **relative to the manifest file's own directory** (so the
    manifest is portable), absolute paths are kept as-is, and either side may
    live **outside the repo** — design specs are often not committed. v1 is
    single still images only; the set/flow shape is P3 (§26.3). Loaded +
    validated by `src/ground-truth/manifest.ts` (`loadGroundTruthManifest`).
  - Glassbox already reads two arbitrary files/folders by path for
    `--diff` (doc [18](18-direct-comparison.md)); the manifest mode builds on the
    same "image bytes from an arbitrary path" plumbing rather than git refs — the
    expected image is the old (A) side, the actual the new (B) side.

## 26.3 Scope of comparison

- **FR-26.5 — Single still images (v1).** v1 compares **one actual image against
  one expected image** at a time (with the previous-actual baseline option).
- **Sets / flows (later).** Comparing a **set** of actuals against a set of
  expecteds — a multi-step flow, potentially captured as animated SVGs via
  domotion — is a later phase. A "compare this actual set against this expected
  set" view, with per-step navigation, is the eventual goal.

## 26.4 Difference metric & pre-processing (P2 — shipped)

- **FR-26.6 — Perceptual diff.** Beyond the visual overlay, the tool scores *how
  different* two images are and pre-filters the noise:
  - **Identical** pairs (0 difference) are **hidden by default** — nothing to
    review — with a "Show N identical" toggle in the source list to reveal them.
  - **Anti-aliasing-only / sub-threshold** differences are tolerated (not counted
    as changes) via a pixelmatch YIQ threshold (0.1).
  - A **general difference score** (fraction of changed pixels, 0–1) surfaces on
    each source-list entry and in the diff header, and sorts the list
    **most-different-first** for triage.
  - The decode + compare is pure JS (no native bindings): **pngjs** + **jpeg-js**
    decode PNG/JPEG to RGBA and **pixelmatch** computes the score
    (`src/ground-truth/perceptual-diff.ts`). Formats that can't be pixel-decoded
    without rasterizing (SVG/WebP/GIF) are surfaced with **no score** rather than
    dropped. Scores are computed once at launch and stored on each review file
    (`review_files.difference_score`), so the sidebar sorts/filters without
    re-decoding.

## 26.5 Capture pipeline (later)

- The expected/actual images often come from **test suites that proactively
  capture screenshots** (and multi-step flows). A later phase defines how those
  captures feed the manifest — potentially leveraging domotion to render flows to
  animated SVGs — so a suite run produces a comparable "actual set". Out of scope
  for the design here beyond noting the integration point.

## 26.6 Non-functional / open questions

- **NFR-26.1 — Reuse, don't fork.** Reuse the doc-24 comparison modes, the doc-23
  region model, and the doc-18 arbitrary-path image plumbing. The new surface is
  the source list + the manifest + (later) the metric — not a second image viewer.
- **Resolved in P1:**
  - **Launch** — a CLI flag, `glassbox --ground-truth <manifest.json>` (no
    in-app picker yet). The resolved comparisons ride in the review mode, so
    resume + the image route need no manifest re-read.
  - **Path safety** — consistent with doc 18 (FR-18.9) / doc [14](14-security.md):
    paths come from a local manifest the user controls, the server binds to
    localhost only, and git is never shelled with these paths, so **no
    repo-containment restriction** is imposed on the expected side (the point is
    that specs live outside the repo). Each path is validated to be a readable
    image at launch.
  - **Previous-actual baselines** — handled purely via the manifest in P1
    (`expected` points at the prior actual; `expectedKind: "previous-actual"`
    is a display hint). Glassbox stores no baseline itself; automatic
    "keep last actual" tooling is P3 (capture pipeline).
- **Still open (later phases):** how a "set" is expressed in the manifest (P3);
  whether the capture pipeline writes/rotates baselines (P3).

## Phasing (follow-up tickets)

- **P1 — Manifest + single-image actual-vs-expected** *(shipped)*, using the
  existing difference/slice/side-by-side + region UI. Defines the manifest format
  (`src/ground-truth/manifest.ts`) and the `--ground-truth <manifest>` launch.
  The expected image is the old/A side, the actual the new/B side; each manifest
  comparison is one synthetic binary image entry whose bytes the image route
  reads from the resolved paths (`getOldImage`/`getNewImage`, doc 18 plumbing).
  No perceptual metric yet (P2). Implementation notes below.
- **P2 — Perceptual diff + pre-processing** *(shipped)*: identical-filtering
  (hidden by default + toggle), anti-aliasing tolerance (pixelmatch YIQ
  threshold), and a difference score (fraction of changed pixels) shown per entry
  + in the diff header and used to sort the list most-different-first. Pure-JS
  decode (`pngjs`/`jpeg-js`) + `pixelmatch`; scores stored on
  `review_files.difference_score`. PNG/JPEG only — other formats show with no
  score. Implementation notes below.
- **P3 — Sets / multi-step flows + capture pipeline** (incl. domotion
  animated-SVG capture) and the previous-actual-baseline tooling.

## Implementation pointers (P1)

- **Mode + manifest:** `ReviewMode` `ground-truth` variant + `GroundTruthEntry`
  (`src/git/types.ts`); loader `src/ground-truth/manifest.ts`
  (`loadGroundTruthManifest`).
- **CLI:** `--ground-truth <manifest>` in `src/cli.ts` (`parseArgs` + the
  no-repo launch branch in `main()`, alongside `--diff`).
- **Diff + mode round-trip:** `getFileDiffs` / `getModeString` /
  `parseModeString` / `getModeArgs` / `getModeFileContent` ground-truth branches
  in `src/git/diff.ts`. Each comparison becomes one `isBinary` image `FileDiff`
  keyed by the manifest's `actual` path (the expected path rides in `oldPath`
  for the right content-type when sides differ in format).
- **Image bytes:** `getOldImage` (→ expected) / `getNewImage` (→ actual) in
  `src/git/image.ts` look the comparison up by key; the existing image route
  (`src/routes/api/image.ts`) is reused unchanged.
- **UI:** reuses the doc-24 image-comparison view (`src/components/imageDiff.tsx`)
  and the doc-23 region/feedback overlay with no changes — a manifest comparison
  is just a binary image pair.

## Implementation pointers (P2)

- **Metric:** `src/ground-truth/perceptual-diff.ts` (`decodeImage` PNG/JPEG→RGBA
  via `pngjs`/`jpeg-js`; `comparePerceptual` runs `pixelmatch` at YIQ threshold
  0.1 → difference score; `isIdentical`). Formatting helpers shared by server +
  client live in `src/utils/diffScore.ts` (`formatDiffPct`, `diffScoreLevel`).
- **Storage:** `review_files.difference_score REAL` (DDL in `src/db/schema.ts`,
  migration in `src/db/connection.ts`, `ReviewFileSchema`, `addReviewFile` param).
  Computed once at launch in `src/cli.ts` (ground-truth branch) and flows to the
  client via the existing `/api/files`.
- **UI:** diff-header "% different" badge (`src/components/diffView.tsx`); sidebar
  per-file badge + most-different-first sort (`src/client/sidebar/fileListView.tsx`
  + `folderTree.ts` `sortFilesByScore`); "Show/Hide N identical" toggle
  (`diffViewStore.hideIdentical`, default on; `folderModeFiles`/`hasIdenticalFiles`
  in `src/client/stores/index.ts`).
- **Deps:** `pixelmatch`, `pngjs`, `jpeg-js` — pure JS, **bundled** by tsup (not
  in the external list), so no sidecar/Tauri changes.

## Tests (P1 + P2)

- Unit: `tests/unit/ground-truth/manifest.test.ts` (load / resolve / dedup /
  validation), `tests/unit/ground-truth/perceptual-diff.test.ts` (decode, score,
  identical, dimension-mismatch, undecodable), `tests/unit/utils/diffScore.test.ts`
  (formatting), ground-truth blocks in `tests/unit/git/diff.test.ts` (mode
  round-trip, file diffs) and `tests/unit/git/image.test.ts` (expected→old /
  actual→new reads), plus the `--ground-truth` case in
  `tests/unit/cli/parseArgs.test.ts`.
- E2E: `tests/e2e/ground-truth.test.ts` (dedicated `--ground-truth` server on
  port 4185; source list, image-comparison render with the expected/actual side
  mapping, an image comment on a repo-less review, completion, the difference
  badge on a scored PNG pair, and the hide/show-identical toggle). Fixtures
  under `tests/fixtures/ground-truth/` (SVG pairs + a differing and an identical
  PNG pair).

## Relationship to existing docs

- [4. Diff Viewing](4-diff-viewing.md) §4.3 and [24. Side-by-Side](24-image-comparison-layouts.md)
  — the image comparison modes this reuses.
- [23. Image Feedback](23-image-feedback.md) — the rectangle region model reused
  for annotating differences.
- [18. Direct Comparison](18-direct-comparison.md) — the existing
  arbitrary-path (`--diff`) comparison the manifest mode generalizes.
