# 26. Ground-Truth Image Comparison

> **Status: Design only.** This document captures the agreed shape of the
> feature; nothing here is implemented yet. Implementation is phased into the
> follow-up tickets listed under "Phasing".

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
  - The manifest format (location, schema, relative vs absolute paths, how a
    "set" is expressed) is to be specified in P1; it should tolerate expected
    files anywhere on disk (design specs are often not committed).
  - Glassbox already reads two arbitrary files/folders by path for
    `--diff` (doc [18](18-direct-comparison.md)); the manifest mode builds on the
    same "image bytes from an arbitrary path" plumbing rather than git refs.

## 26.3 Scope of comparison

- **FR-26.5 — Single still images (v1).** v1 compares **one actual image against
  one expected image** at a time (with the previous-actual baseline option).
- **Sets / flows (later).** Comparing a **set** of actuals against a set of
  expecteds — a multi-step flow, potentially captured as animated SVGs via
  domotion — is a later phase. A "compare this actual set against this expected
  set" view, with per-step navigation, is the eventual goal.

## 26.4 Difference metric & pre-processing (fast-follow)

- **FR-26.6 — Perceptual diff (fast-follow, not v1).** Beyond the visual overlay,
  the tool should score *how different* two images are and pre-filter the noise:
  - **Identical** pairs are filtered out (nothing to review).
  - **Anti-aliasing-only / sub-threshold** differences are tolerated (not flagged
    as real changes) — e.g. a pixelmatch-style threshold or an SSIM-like metric.
  - A **general difference score** sensitive enough to surface meaningful changes
    while ignoring the above, used to sort/triage the review list.
  - This is a **fast-follow** after the visual comparison + region marking work;
    see the follow-up ticket. It likely wants a small, dependency-light image
    decode + compare (consistent with the no-native-deps stance of the existing
    `src/git/image-metadata.ts`).

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
- **Open:** manifest schema + location; how the mode is launched (a new CLI flag,
  e.g. `--ground-truth <manifest>`, vs an in-app picker); how expected files
  outside the repo are referenced safely (path containment); whether previous-
  actual baselines are stored by Glassbox or supplied by the capture tooling.

## Phasing (follow-up tickets)

- **P1 — Manifest + single-image actual-vs-expected**, using the existing
  difference/slice/side-by-side + region UI. Defines the manifest format and the
  mode launch. (No metric yet.)
- **P2 — Perceptual diff + pre-processing**: identical-filtering,
  anti-aliasing tolerance, a difference score that sorts the review list.
- **P3 — Sets / multi-step flows + capture pipeline** (incl. domotion
  animated-SVG capture) and the previous-actual-baseline tooling.

## Relationship to existing docs

- [4. Diff Viewing](4-diff-viewing.md) §4.3 and [24. Side-by-Side](24-image-comparison-layouts.md)
  — the image comparison modes this reuses.
- [23. Image Feedback](23-image-feedback.md) — the rectangle region model reused
  for annotating differences.
- [18. Direct Comparison](18-direct-comparison.md) — the existing
  arbitrary-path (`--diff`) comparison the manifest mode generalizes.
