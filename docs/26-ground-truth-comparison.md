# 26. Ground-Truth Image Comparison

> **Status: P1–P3 shipped.** P1 + P2: manifest + single-image actual-vs-expected
> mode; perceptual diff + identical-filtering + difference-score triage. P3a +
> P3b: the `version: 2` manifest loader + set/flow model; the source-list **set
> groups** (collapsible, max-aggregate badge, ordered step rows) + diff-header
> **per-step navigator**. P3c: the **proof-export guidance** doc + portable AI
> skill ([`docs/proof-export-guidance.md`](proof-export-guidance.md),
> [`docs/skills/export-review-proof/`](skills/export-review-proof/SKILL.md)). P3d:
> the optional **`glassbox ground-truth promote`** baseline-rotation helper.
> Glassbox stays **consumer-only** throughout (runs no capturer, owns no baseline
> state). Out-of-scope refinements (cross-step diffs, contact-sheet views) remain
> possible later work (§26.3).

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
- **FR-26.7 — Expected/Actual side labels (shipped).** In ground-truth mode the
  side-by-side comparison panes read **"Expected (A)"** / **"Actual (B)"** rather
  than the generic "Old (A)" / "New (B)". The expected image is the old/A side,
  the actual is the new/B side. The server-rendered diff view passes the label
  override into `ImageDiff` only when the review mode is ground-truth; every
  other mode keeps the Old/New defaults. (`groundTruthSideLabels` in
  `src/ground-truth/presentation.ts`.)
- **FR-26.8 — Source list reads as named comparisons (shipped).** For a
  ground-truth review the sidebar is a **flat list of named comparisons**, not an
  `actual/` file tree: each row is captioned by the manifest **`label`** (falling
  back to the actual-image basename when no label is given) and carries a small
  **`expectedKind` badge** — **Spec** / **Reference** / **Baseline** (for
  `previous-actual`). Rows sort most-different-first (reusing the P2 perceptual
  score) and the text filter matches the label as well as the raw key. The raw
  key remains the row's `title` for hover + stable selection. (Built from a
  `fileId → {label, expectedKind}` map the `/files` response carries only for
  ground-truth reviews; `groundTruthMetaByFileId` in
  `src/ground-truth/presentation.ts`, rendered by `groundTruthListJsx` in
  `src/client/sidebar/fileListView.tsx`.)

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
  - **Designed format (P3 — `version: 2`, additive).** v2 keeps `comparisons`
    (singles) exactly as v1 and adds an optional **`sets`** array for ordered
    multi-step flows. A v2 manifest must have at least one non-empty of
    `comparisons` / `sets`. Each **step** is exactly a v1 comparison shape
    (`actual` + `expected` + optional `label`/`expectedKind`), so the per-pair
    resolver is reused unchanged; a set-level `label`/`expectedKind` is the
    default its steps inherit (a step may override):

    ```json
    {
      "version": 2,
      "comparisons": [
        { "actual": "out/login.png", "expected": "design/login.png",
          "label": "Login screen", "expectedKind": "spec" }
      ],
      "sets": [
        {
          "label": "Checkout flow",
          "expectedKind": "spec",
          "steps": [
            { "actual": "out/checkout/1-cart.png",    "expected": "design/checkout/1-cart.png",    "label": "Cart" },
            { "actual": "out/checkout/2-address.png", "expected": "design/checkout/2-address.png", "label": "Address" },
            { "actual": "out/checkout/3-confirm.svg", "expected": "design/checkout/3-confirm.svg", "label": "Confirmation (animated)" }
          ]
        }
      ]
    }
    ```

    - **Back-compat.** A `version: 1` manifest stays valid forever (no `sets`).
      `version: 2` is accepted by the same loader; an unknown `version` is a
      descriptive load error (as today).
    - **Animated flows are just steps** whose `actual`/`expected` happen to be
      **animated SVGs** (e.g. domotion output). They render live in the browser
      (the GB-932 raw-`image/svg+xml` `<img>` path), so the flow animates inside
      the existing comparison view — no new viewer.
    - **Key derivation.** Each step resolves to one synthetic image pair keyed
      `set:<setIndex>/<stepIndex>-<actualBasename>` (deduped like v1 keys), so
      steps are stable, ordered, and distinct in the review even when basenames
      repeat across sets.
  - Glassbox already reads two arbitrary files/folders by path for
    `--diff` (doc [18](18-direct-comparison.md)); the manifest mode builds on the
    same "image bytes from an arbitrary path" plumbing rather than git refs — the
    expected image is the old (A) side, the actual the new (B) side. Sets add
    **grouping + order** on top of the same per-pair plumbing.

## 26.3 Scope of comparison

- **FR-26.5 — Single still images (v1).** v1 compares **one actual image against
  one expected image** at a time (with the previous-actual baseline option).

### Sets / multi-step flows (P3 — designed)

- **FR-26.9 — A set is an ordered flow.** A **set** compares an actual *set* of
  images against an expected *set* — a multi-step flow (e.g. a checkout journey,
  an onboarding sequence). Steps are **ordered** (step 1..N) and navigated
  sequentially. An "unordered group" is not a separate concept — it's just a
  flow whose order the reviewer doesn't care about; modeling only the ordered
  case keeps the UI and manifest simple. Declared via the `version: 2`
  manifest's `sets` (§26.2).
- **FR-26.10 — Source list: sets are named groups of steps.** The flat
  named-comparison list (§26.1 / FR-26.8) gains a **group** level for sets: the
  set `label` is a header carrying the set's aggregate difference (FR-26.11) and
  expandable to its **ordered step rows**, each step captioned by its own label
  (basename fallback) + per-step difference badge + `expectedKind`. Singles
  (`comparisons`) continue to render as today, intermixed with set groups.
  Reuses the existing collapsible folder/group rendering rather than a new tree.
- **FR-26.11 — Per-step + aggregate scoring.** Each step is scored by the P2
  perceptual diff exactly like a single (PNG/JPEG; animated SVG/other formats
  show with no score). A set's **aggregate** difference is the **max** of its
  steps' scores (matching the risk aggregate convention — the worst step drives
  triage), shown on the set header; the set sorts among singles by that
  aggregate, most-different-first. Identical-pair hiding (P2) applies per step;
  a set all of whose steps are identical is hidden as a unit.
- **FR-26.12 — Per-step navigation.** When viewing a step, the diff header shows
  a **"Step k of N — ‹ Prev · Next ›"** control plus the step label, so the
  reviewer can walk the flow without returning to the sidebar. Steps of a set are
  consecutive in the keyboard/file nav order, so existing prev/next file
  navigation already walks a flow; the header control is the explicit affordance
  and bounds movement to the current set. Region marking (doc 23) + the doc-24
  comparison modes work per step unchanged (each step is one image pair).
- **Out of scope for P3:** cross-step diffs ("what changed between step 2 and
  step 3 of the actual"), and side-by-side *all-steps* contact-sheet views. Both
  are possible later refinements; P3 is "review each step of a flow against its
  expected, in order."

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

## 26.5 Capture pipeline (P3 — designed, consumer-only)

The expected/actual images often come from **test suites that proactively
capture screenshots** (and multi-step flows). P3 defines how those captures feed
Glassbox — **without Glassbox running any capturer itself**.

- **FR-26.13 — Consumer-only contract.** Glassbox **does not invoke** domotion,
  a browser, or any capture tool, and takes on **no new runtime dependency** on
  them. It consumes whatever a project's own test suite / capture step has
  **already written to disk**, declared via the `version: 2` manifest. This
  mirrors how Glassbox consumes producer-written `.pr-notes/` SARIF (doc
  [20](20-ai-review-notes.md)) and arbitrary-path images (doc
  [18](18-direct-comparison.md)), and upholds NFR-26.1 ("reuse, don't fork").
  The integration point is exactly: *a project emits image/SVG files + a
  manifest; `glassbox --ground-truth <manifest>` reviews them.*
- **FR-26.14 — Proof-export guidance.** Glassbox (and Glassbox/Hot-Sheet–
  integrated projects) should ship **guidance** that hints how a software project
  can export reviewable **proof** for ground-truth review. The guidance is
  documentation/convention, not a Glassbox runtime feature, and covers the
  common proof modalities:
  - **Screenshots** (PNG/JPEG) — still-state proof; one file per step. The
    natural output of most e2e/visual-test runners.
  - **Logs / textual proof** — already a first-class Glassbox concept as AI
    review-note **text artifacts** (doc 20 §20.5); cross-referenced here so a
    project exports run logs as note artifacts, not as ground-truth images.
  - **Complex animated flows** — render a multi-step interaction to a **single
    animated SVG** (e.g. via [domotion](https://github.com/brianwestphal/domotion))
    and reference it as one step's `actual`; it animates live in the comparison
    view (§26.2). This lets a whole interaction be reviewed as one artifact, or
    decomposed into per-frame still steps — the project's choice.
  - **Suggested layout convention.** A capture step writes
    `<proof-dir>/<flow>/NN-step.{png,svg}` for actuals (and a parallel
    expected/baseline tree) plus a generated `manifest.json`, so a single suite
    run produces a directly-reviewable "actual set". The exact directory names
    are a project convention, not enforced by Glassbox.
- This proof-export guidance is broader than ground-truth (it touches logs +
  note artifacts too), so the **authoring of the guidance doc / AI skill** for
  Glassbox/Hot-Sheet–integrated projects is tracked as its own follow-up rather
  than inlined here. **Shipped (P3c):** the guidance lives in
  [`docs/proof-export-guidance.md`](proof-export-guidance.md), with a portable
  per-project AI skill at
  [`docs/skills/export-review-proof/SKILL.md`](skills/export-review-proof/SKILL.md)
  (copy into an integrated project's `.claude/skills/`). Glassbox stays
  consumer-only — these are documentation/convention, no runtime capturer.

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
- **Resolved in P3 design:**
  - **How a "set" is expressed** — the `version: 2` manifest's `sets` array of
    ordered `steps` (§26.2); each step is a v1 comparison shape.
  - **FR-26.15 — Baseline rotation stays external.** Consistent with P1/P2 and
    the consumer-only contract (FR-26.13), **Glassbox does not store or rotate
    baselines.** Previous-actual regression over a flow works by the capture
    pipeline writing this run's actual set into the baseline location that the
    *next* run's manifest points its `expected` steps at (`expectedKind:
    "previous-actual"`). An **optional convenience** — a `glassbox ground-truth
    promote <manifest>` helper that copies the current actuals over the baseline
    tree — ships as P3d but is **not** part of P3's core, so the feature works
    without it and Glassbox never owns baseline state. *(Shipped, P3d.)* The
    helper (`src/ground-truth/promote.ts`, dispatched as a standalone subcommand
    in `src/cli.ts`) copies **only** `expectedKind: "previous-actual"` entries'
    actual→expected — spec / reference expecteds are never overwritten, so a
    stray `promote` can't clobber a committed design spec. It runs no server and
    touches no review DB; it is a pure, explicit file copy.

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
- **P3 — Sets / multi-step flows + capture-pipeline guidance + baseline
  rotation** *(designed above; implementation in phased follow-ups)*. Resolved
  design: a `version: 2` additive manifest with ordered `sets`/`steps` (§26.2);
  source-list **set groups** with per-step rows, per-step + max-aggregate
  perceptual scoring, and a **per-step Prev/Next** navigator (§26.3); a
  **consumer-only** capture contract — Glassbox runs no capturer and gains no
  domotion dependency — plus **proof-export guidance** for projects (screenshots,
  logs-as-note-artifacts, animated-SVG flows; §26.5); and **external** baseline
  rotation (FR-26.15). Suggested implementation sub-phases:
  - **P3a — `version: 2` loader + set model** *(shipped)*. `manifest.ts` parses
    `sets`/`steps` (back-compat with v1), resolves each step to a synthetic image
    pair keyed `set:<i>/<j>-<basename>` (shared dedup with singles), and carries
    set grouping/order on each resolved `GroundTruthEntry` (`setIndex`,
    `setLabel`, `stepIndex`, `stepCount`) — so the flat entry array rides the
    existing mode round-trip and the image route / scoring need no changes. Steps
    inherit the set's `expectedKind` default (a step may override); a step's
    `label` is its own (the set `label` captions only the group header). Pure +
    unit-tested; no UI yet (P3b).
  - **P3b — Source-list set groups + per-step nav + aggregate scoring**
    *(shipped)*. Sets render as collapsible named groups in the §26.1 named list
    (`buildGroundTruthSourceList` in `src/client/sidebar/groundTruthGroups.ts` —
    pure, shared by the sidebar render and the keyboard-nav order so a flow's
    steps walk consecutively); the header carries the set's **max-aggregate**
    perceptual score and each step row its own P2 score; identical hiding is
    per-step (an all-identical set drops out as a unit). The diff header shows a
    **"Step k of N — ‹ Prev · Next ›"** navigator bounded to the current set
    (`groundTruthStepNav` in `src/ground-truth/presentation.ts`; the Prev/Next
    buttons carry the sibling step's review-file id and select it via the diff
    container's delegate handler). `GroundTruthMeta` (`src/api/files.ts`) carries
    the set grouping to the client.
  - **P3c — Proof-export guidance doc / AI skill** for Glassbox/Hot-Sheet–
    integrated projects (screenshots, logs as note artifacts, animated-SVG flows
    via domotion; suggested manifest-emitting layout). Broader than ground-truth.
    *(shipped)* — [`docs/proof-export-guidance.md`](proof-export-guidance.md) +
    the portable [`docs/skills/export-review-proof/SKILL.md`](skills/export-review-proof/SKILL.md).
  - **P3d — (optional) `glassbox ground-truth promote` baseline helper**
    *(shipped)* — `glassbox ground-truth promote <manifest>` copies current
    actuals over the baseline tree for next-run regression. Promotes **only**
    `expectedKind: "previous-actual"` entries (specs/references are never
    overwritten); standalone subcommand (`src/ground-truth/promote.ts`), no
    server / no review DB. Glassbox still owns no baseline state — promote is an
    explicit user action.

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

## Implementation pointers (UX polish — FR-26.7 / FR-26.8)

- **Presentation helpers:** `src/ground-truth/presentation.ts` — pure, shared by
  the diff page and the file-list route. `groundTruthSideLabels(mode)` →
  Expected/Actual captions; `groundTruthMetaByFileId(mode, files)` → the per-file
  `{label, expectedKind}` map; `EXPECTED_KIND_LABELS` → Spec / Reference /
  Baseline.
- **Side labels:** optional `sideLabels` prop on `ImageDiff`
  (`src/components/imageDiff.tsx`), threaded through `DiffView`'s
  `imageSideLabels` and set in `src/routes/pages.tsx` (both the binary-image and
  rendered-SVG paths) only for ground-truth reviews.
- **Source list:** `/files` response carries an optional `groundTruth`
  (`fileId → {label, expectedKind}`) map (`src/api/files.ts` +
  `src/routes/api/files.ts`); the client stores it on `reviewStore.groundTruth`
  (`isGroundTruthReview` / `groundTruthMeta` helpers in
  `src/client/stores/index.ts`), and `groundTruthListJsx` renders the flat named
  list with the `.gt-kind` badge (`src/client/sidebar/fileListView.tsx`,
  `_ai-sort.scss`).

## Tests (P3a / P3b)

- Unit: the `version: 2` blocks in `tests/unit/ground-truth/manifest.test.ts`
  (set parse, step key derivation/dedup, `expectedKind` inheritance + override,
  ordering, validation errors, unsupported version), `groundTruthStepNav` cases
  in `tests/unit/ground-truth/presentation.test.ts`, and
  `tests/unit/client/groundTruthGroups.test.ts` (single/set grouping, max
  aggregate, step ordering, intermixed sort, nav-order flattening).
- E2E: the `version: 2` set fixture (a 2-step "Checkout flow" of scored PNGs) in
  `tests/fixtures/ground-truth/manifest.json`, asserted by
  `tests/e2e/ground-truth.test.ts` (set group with aggregate badge + ordered
  step rows; the diff-header step navigator walking Prev/Next bounded to the set).

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
- UX polish (FR-26.7 / FR-26.8): unit `tests/unit/ground-truth/presentation.test.ts`
  (side labels, per-file metadata map, kind labels); E2E assertions in
  `tests/e2e/ground-truth.test.ts` for the manifest label + `expectedKind` badge
  in the source list and the Expected (A) / Actual (B) pane captions.

## Relationship to existing docs

- [4. Diff Viewing](4-diff-viewing.md) §4.3 and [24. Side-by-Side](24-image-comparison-layouts.md)
  — the image comparison modes this reuses.
- [23. Image Feedback](23-image-feedback.md) — the rectangle region model reused
  for annotating differences.
- [18. Direct Comparison](18-direct-comparison.md) — the existing
  arbitrary-path (`--diff`) comparison the manifest mode generalizes.
