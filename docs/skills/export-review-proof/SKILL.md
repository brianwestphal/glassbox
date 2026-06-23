---
name: export-review-proof
description: Export reviewable proof (screenshots, flows, logs) for Glassbox ground-truth review. Use this after implementing a change whose visible/behavioral/runtime effect should be reviewed — e.g. a UI change, a multi-step flow, or a computed result that needs evidence. Produces a version:2 manifest reviewable via `glassbox --ground-truth`.
---

# Export Review Proof for Glassbox

You are working in a project that uses **Glassbox** for review. When you finish a
change whose effect should be *seen*, don't just describe it — export **proof**
that a reviewer (or a later AI session) can inspect. Glassbox is **consumer-only**:
it runs no capturer. You write proof to disk; Glassbox reviews it.

There are three kinds of proof. Pick by what you're proving.

## 1. Visual state — a screenshot

For a change to a screen, component, or rendered output:

- Capture the **actual** state as a PNG/JPEG (your test runner's screenshot API —
  Playwright `page.screenshot()`, etc.). One file per state worth reviewing.
- Pair it with an **expected** image: a design spec, a reference render, or the
  previous run's actual (a regression baseline). The expected may live outside the
  repo (specs often aren't committed).
- Glassbox scores the perceptual difference, hides identical pairs, and sorts
  most-different-first.

## 2. Behavior over time — a flow

For a multi-step interaction (a journey, a sequence), choose one:

- **One animated SVG.** Render the whole interaction to a single animated SVG
  (e.g. via domotion) and reference it as **one step's `actual`**. It animates live
  in the comparison view. Best when the *motion* is the point.
- **Per-frame still steps.** One ordered PNG per step (`NN-step.png`), declared as
  a manifest **set**. Glassbox renders a per-step "Step k of N" navigator with
  per-step scoring. Best when each *state* needs its own pass.

## 3. Textual / runtime proof — a review note, NOT a screenshot

For logs, computed values, or request/response bodies: do **not** screenshot text.
Write a line-anchored **review-note text artifact** with the Glassbox producer CLI,
attached to the code it proves:

```sh
glassbox note add --file <file> --lines <A[-B]> --kind proof --body "What this proves" --artifact run.log
```

`--kind` is one of `rationale`, `proof`, `assumption`, `alternative-considered`,
`risk`, `test-evidence`; `--lines` is 1-based (`A` or `A-B`); `--body` accepts `-`
to read from stdin; `--artifact` (repeatable) attaches a committed proof file.
Commit `.pr-notes/` alongside the code. See the project's Glassbox doc 20 (or run
`glassbox note instructions`) for the full contract.

## Emit the manifest and hand it off

Write a predictable tree, then generate a `version: 2` manifest over it:

```
proof/<area>/
  actual/   ...   # your captures (PNG/JPEG/SVG)
  expected/ ...   # parallel specs / baselines
  manifest.json
```

```json
{
  "version": 2,
  "comparisons": [
    { "actual": "actual/login.png", "expected": "expected/login.png", "label": "Login", "expectedKind": "spec" }
  ],
  "sets": [
    { "label": "Checkout", "expectedKind": "spec", "steps": [
      { "actual": "actual/checkout/1-cart.png", "expected": "expected/checkout/1-cart.png", "label": "Cart" },
      { "actual": "actual/checkout/2-pay.png",  "expected": "expected/checkout/2-pay.png",  "label": "Pay" }
    ]}
  ]
}
```

Paths resolve relative to the manifest's directory. Then tell the reviewer:

```sh
glassbox --ground-truth proof/<area>/manifest.json
```

No git repo is required for the manifest mode.

## Checklist before you finish

- [ ] Every reviewable visual state has an `actual` + an `expected`.
- [ ] Multi-step flows are either one animated SVG or an ordered manifest `set`.
- [ ] Textual proof is a `glassbox note` artifact on the relevant line — never a screenshot of text.
- [ ] A `version: 2` manifest covers the captured tree, and you handed over the `glassbox --ground-truth <manifest>` command.

## Notes

- `expectedKind` is a display hint: `spec` (design spec), `reference` (reference
  render), or `previous-actual` (a regression baseline, shown as "Baseline").
- For regression over a flow, point this run's `expected` at the prior run's
  actuals and rotate the baseline **outside** Glassbox (it stores no baseline).
- Animated-SVG steps need no special handling — Glassbox serves them as raw
  `image/svg+xml` so they animate live.
