# Exporting Reviewable Proof for Glassbox

> **Audience:** maintainers and AI agents working in a project that uses Glassbox
> for review — especially Glassbox/Hot-Sheet–integrated projects. This is
> **convention + guidance**, not a Glassbox runtime feature. Glassbox stays
> **consumer-only**: it runs no capture tool and takes on no capture dependency
> (doc [26](26-ground-truth-comparison.md) §26.5 FR-26.13). Your project's own
> test suite / capture step writes proof to disk; Glassbox reviews it.

When an AI agent (or a human) finishes a piece of work, the change is only half
the story — the other half is **proof that it does what it claims**. Glassbox can
review three kinds of proof. This doc explains how to export each so a reviewer
(or a follow-up AI session) can inspect it.

## The three proof modalities

| Proof | Looks like | Export as | Reviewed via |
| --- | --- | --- | --- |
| **Visual state** | A screenshot of a screen/component | PNG/JPEG file per step | **Ground-truth comparison** (doc 26) — actual vs expected/spec/baseline |
| **Behavior over time** | A multi-step interaction (a flow) | One **animated SVG**, or per-frame PNGs | **Ground-truth comparison** (doc 26) — animates live in the comparison view, or steps walk in order |
| **Textual / runtime** | Logs, computed values, API responses | An AI **review-note text artifact** (doc 20 §20.5) | Inline review notes on the relevant code line |

The first two are images and flow through `glassbox --ground-truth`. The third is
**text** and should ride as a note artifact, **not** as a ground-truth image —
don't screenshot a terminal to prove a log line.

## 1. Visual state → screenshots (PNG/JPEG)

Still-state proof is the natural output of most e2e / visual-test runners
(Playwright `page.screenshot()`, Cypress, Storybook snapshots, etc.). One file per
state you want reviewed.

- Capture an **actual** image and pair it with an **expected** image — a design
  spec, a reference render, or the previous run's actual (a regression baseline).
- Glassbox scores the perceptual difference (PNG/JPEG), hides identical pairs, and
  sorts most-different-first, so a reviewer triages the changed states first.
- The pairing is declared in a **manifest** (next section). Expected images may
  live **outside** the repo — design specs often aren't committed.

## 2. Behavior over time → animated SVG, or per-frame steps

A multi-step interaction (a checkout journey, an onboarding sequence) is a **flow**.
Two ways to export it, your choice per flow:

- **One animated SVG.** Render the whole interaction to a single animated SVG
  (e.g. via [domotion](https://github.com/brianwestphal/domotion), a DOM-to-
  animated-SVG renderer) and reference it as **one step's `actual`**. Glassbox
  serves SVGs as raw `image/svg+xml` in a native `<img>`, so the animation plays
  live inside the comparison view — the whole flow is reviewed as one artifact.
- **Per-frame still steps.** Decompose the flow into ordered screenshots — one
  PNG per step — and declare them as a `version: 2` manifest **set** (next
  section). Glassbox renders the set as a named group with a per-step
  **"Step k of N — ‹ Prev · Next ›"** navigator and a per-step difference score.

Prefer the animated SVG when the *motion* is the point; prefer per-frame steps
when each *state* needs its own pass and per-step scoring.

## 3. Textual / runtime proof → review-note text artifacts

Logs, computed values, request/response bodies, and other textual evidence are
**not** images. Export them as AI **review-note text artifacts** (doc
[20](20-ai-review-notes.md) §20.5): the generating AI writes a line-anchored note
into `.pr-notes/` whose artifact carries the text inline, and Glassbox renders it
folded under the relevant code line. Use the `glassbox note` producer CLI (doc 20)
to author these. This keeps textual proof attached to the *code it proves*, where
a reviewer reading the diff will see it — not buried in a screenshot.

## Suggested layout + the `version: 2` manifest

A capture step that writes a predictable tree is directly reviewable with no extra
wiring. Suggested convention (the directory names are yours — Glassbox enforces
none of them):

```
proof/
  <flow-or-area>/
    actual/
      login.png                # a single still
      checkout/
        1-cart.png             # ordered flow steps (NN-step naming)
        2-address.png
        3-confirm.svg          # an animated-SVG step
    expected/                  # parallel tree of specs / baselines
      login.png
      checkout/
        1-cart.png
        2-address.png
        3-confirm.svg
    manifest.json              # generated, version: 2
```

Generate a `version: 2` manifest (doc 26 §26.2) mapping each actual to its
expected. Singles go in `comparisons`; ordered flows go in `sets`:

```json
{
  "version": 2,
  "comparisons": [
    { "actual": "actual/login.png", "expected": "expected/login.png",
      "label": "Login screen", "expectedKind": "spec" }
  ],
  "sets": [
    {
      "label": "Checkout flow",
      "expectedKind": "spec",
      "steps": [
        { "actual": "actual/checkout/1-cart.png",    "expected": "expected/checkout/1-cart.png",    "label": "Cart" },
        { "actual": "actual/checkout/2-address.png", "expected": "expected/checkout/2-address.png", "label": "Address" },
        { "actual": "actual/checkout/3-confirm.svg", "expected": "expected/checkout/3-confirm.svg", "label": "Confirmation" }
      ]
    }
  ]
}
```

Paths resolve **relative to the manifest file's directory**, so the tree is
portable. Then:

```sh
glassbox --ground-truth proof/<flow-or-area>/manifest.json
```

No git repository is required (the manifest mode is repo-independent, like
`--diff`, doc [18](18-direct-comparison.md)).

### Baselines (regression over a flow)

To regression-check this run against the previous one, point a step's `expected`
at the prior run's actual and set `expectedKind: "previous-actual"` (renders as a
**Baseline** badge). **Glassbox stores no baseline itself** (doc 26 FR-26.15) — the
capture pipeline owns rotation: after a reviewed run, copy this run's actuals over
the baseline location the *next* run's manifest points its `expected` steps at.
An optional `glassbox ground-truth promote` helper can do this copy; see doc 26
§26.6 / its follow-up ticket.

## For AI agents in integrated projects

If you are an AI agent producing work in a project that uses Glassbox, a portable
skill encodes this contract step-by-step so you emit proof automatically:
[`docs/skills/export-review-proof/SKILL.md`](skills/export-review-proof/SKILL.md).
Copy it into the project's `.claude/skills/` (or adapt it as a Cursor rule) so any
agent can follow it. The short version:

1. **Visual state** → screenshot the state; pair each actual with its expected.
2. **Flows** → one animated SVG, or ordered per-frame PNGs as a manifest `set`.
3. **Textual proof** → a `glassbox note` text artifact on the relevant line — never a screenshot of text.
4. **Emit a `version: 2` manifest** over the captured tree, and hand the reviewer `glassbox --ground-truth <manifest>`.

## Relationship to other docs

- [26. Ground-Truth Comparison](26-ground-truth-comparison.md) — the review mode
  this proof feeds (§26.5 is the capture-pipeline contract this doc fulfills).
- [20. AI Review Notes](20-ai-review-notes.md) — text artifacts for logs/runtime
  proof (§20.5).
- [18. Direct Comparison](18-direct-comparison.md) — the repo-less arbitrary-path
  plumbing the manifest mode builds on.
