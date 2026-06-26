---
name: prep-major-release
description: Prepare the repo for a major release — review/update README.md so it stays compelling, and review the demo scenarios + screenshot scenes, proposing and applying any new/different/fewer screenshots (the maintainer captures them after).
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, Agent
---

Prepare Glassbox for a major release. A lot has usually changed since the last
release, so the public-facing story drifts: the **README** stops advertising the
best features, and the **demo screenshots** stop matching the UI. This skill
brings both back in line.

Two deliverables, in order:

1. **README.md** — reviewed and updated so it stays compelling and advertises the
   most important and interesting features.
2. **Demo scenarios + screenshot scenes** — reviewed, with any *new / different /
   fewer* screenshots proposed and the **code changes applied**, then handed off
   to the maintainer to capture. **Do not capture screenshots yourself** —
   capturing needs Chromium outside the command sandbox and the maintainer does
   it (they said so). Your job is to get the scenes *ready to capture* and tell
   them exactly what to run.

## Step 0 — Orient (what's new since last time)

Before touching the README, build an accurate picture of the current feature set
so you advertise what actually ships today, not what shipped a year ago:

- Read `docs/ai/requirements-summary.md` and `docs/ai/code-summary.md` — the
  fastest synthesis of every feature and its status (Shipped / Partial / …).
- Skim the requirements index in `CLAUDE.md` and any newer numbered docs in
  `docs/` that the README predates.
- `git log --oneline -40` (or since the last release tag: `git log --oneline
  $(git describe --tags --abbrev=0 2>/dev/null)..HEAD`) to see what landed.
- Note features that are **shipped but absent or undersold** in the README, and
  README claims that are **stale** (removed/renamed/changed). Consider spawning an
  `Agent` (Explore) to diff "features in the docs/code" against "features in the
  README" if the gap is large.

## Step 1 — Review & update README.md

`README.md` is the front door (also rendered on npm and GitHub). Read it in full,
then revise for:

- **Compelling top-of-funnel.** The hero tagline + first two paragraphs must make
  the value obvious in seconds: local, browser-based review of AI-generated code
  with structured feedback an AI tool can act on. Keep the "you, the diff, and a
  tight feedback loop" energy — punchy, not corporate.
- **Advertise the most important & interesting features**, with the strongest
  ones highest. As of this writing the standouts worth leading with or featuring:
  AI risk / narrative / guided review intelligence; AI-authored review notes
  (`.pr-notes/`); image & SVG comparison (difference/slice/side-by-side, the A/B
  single-side focus, doc 28); ground-truth image comparison with perceptual diff;
  direct path comparison (`--diff`) and `git difftool` integration; attachments;
  themes; the Claude Code MCP channel; desktop app. Re-check this list against
  Step 0 — features get added; promote new ones, demote anything retired.
- **Accuracy.** Every CLI flag, install step, provider, and capability claim must
  match reality (`src/cli.ts` for flags/usage, the requirements docs for
  behavior). Fix anything stale. Don't invent features.
- **Screenshots resolve and still represent the feature.** Each `<img
  src="assets/…">` must point at a file that exists and shows what the
  surrounding prose claims. Build the authoritative list of referenced images:
  `grep -oE 'assets/[A-Za-z0-9_.-]+\.(png|svg)' README.md | sort -u`. Cross-check
  against `assets/` and against the scene list in Step 2. Note (don't fix yet)
  any screenshot that should be re-shot because the UI moved — that feeds Step 2.
- **Structure & links.** Headings scan well, the feature table/bullets are
  current, internal links (`docs/…`, anchors) and the releases/npm links work.

Apply the edits directly to `README.md`. Keep American-English spelling and the
project's no-emoji rule (see `CLAUDE.md`) — applies to README prose too.

## Step 2 — Review the demo scenarios & screenshot scenes

The README's stills are generated from real app states. The pipeline:

- **Demo scenarios** — `src/demo.ts` (`DEMO_SCENARIOS`, the `--demo:N` list +
  per-scenario setup) backed by canned data in `src/demo/fixtures.ts`. Doc 12
  (`docs/12-demo-mode.md`) is the spec.
- **Still capture** — `scripts/demo/capture-stills.ts` defines a `SCENARIOS`
  array; each entry boots `--demo:N` (or `--ground-truth …`), drives the UI into
  the showcased state, and writes `assets/demo-<slug>.png` (+ a standalone
  `.svg` unless `pngOnly`). Run with `npm run demo:capture-stills`
  (`--only <slug1,slug2>` to iterate on one). These are the README stills.
- **Animated hero** — `assets/demo.svg` is produced separately by
  `scripts/demo/capture-demo.ts` (`npm run demo:capture`). Out of scope unless the
  hero is clearly stale; if so, note it for the maintainer rather than rebuilding
  it here.

Review the set and decide what should change. Build the three-way map —
**README `<img>` ↔ `capture-stills.ts` scene slug ↔ `--demo:N` scenario** — and
look for:

- **Missing coverage (new screenshot).** A marquee feature added since the last
  release with no still (e.g. a new comparison mode, a new AI surface). If it
  deserves a screenshot, add a `SCENARIOS` entry (and, if it needs a UI state the
  demo data doesn't yet produce, extend `DEMO_SCENARIOS` in `src/demo.ts` +
  `src/demo/fixtures.ts` so a real `--demo:N` reaches that state). Then reference
  the new `assets/demo-<slug>.png` from the README.
- **Stale screenshot (different).** A scene whose UI moved enough that the still
  misrepresents it. Fix the scene's `setup()` so it captures the current,
  best-looking state. Keep captures deterministic and machine-independent
  (the script already isolates `GLASSBOX_CONFIG_DIR` and uses `--ai-service-test`
  — preserve that).
- **Redundant screenshot (fewer).** Two stills showing nearly the same thing, or
  a feature no longer worth a dedicated image. Drop the weaker one from the README
  and remove its `SCENARIOS` entry so the set stays tight.

Apply the **code** changes (`README.md`, `scripts/demo/capture-stills.ts`,
`src/demo.ts`, `src/demo/fixtures.ts`) and keep docs in sync — if you add/retire a
`--demo:N` scenario, update `docs/12-demo-mode.md` and the AI summaries
(`docs/ai/*`) per `CLAUDE.md`. **Do not run the capture** — the maintainer does
that.

## Step 3 — Hand off the capture checklist

Because the maintainer captures the screenshots, end with a clear, runnable
handoff:

- **What changed and why** — the README revisions, and per scene: added /
  re-shoot / removed, with the one-line reason.
- **Exact commands to capture** — e.g.
  `npm run demo:capture-stills -- --only <slug1,slug2>` for the changed scenes, or
  `npm run demo:capture-stills` for a full refresh; note it MUST run outside the
  command sandbox (Chromium needs Mach ports/IPC). If the animated hero needs a
  redo, mention `npm run demo:capture` separately.
- **What to verify after capture** — the new `assets/demo-*.png` render correctly
  and the README references them.

If a decision is genuinely the maintainer's (e.g. "should we drop the narrative
screenshot or keep both?") and you can't resolve it from the code/docs, ask via
the Hot Sheet `FEEDBACK NEEDED:` mechanism rather than guessing — see the
worklist. Otherwise pick the obvious option, state it, and proceed.

## Guardrails

- **Don't capture screenshots or run the demo servers** — the maintainer does.
  Your output is committed code + a capture checklist.
- **Don't `git push`** (and don't `git commit` unless asked) — follow the
  project's git conventions in `CLAUDE.md`.
- **Keep docs in sync** in the same pass — README claims, `docs/12-demo-mode.md`,
  and the AI summaries must all match what you changed.
- **American-English spelling, no emoji / decorative glyphs** in any prose or UI
  string you touch.
- **Typecheck if you touched TS** (`npm run typecheck`; `npm run lint`) so the
  capture script + demo changes still build before handoff.

## Output

A short report: the README changes made; the screenshot-scene decisions (added /
re-shot / removed, each with a reason); the exact capture command(s) for the
maintainer to run; and anything left for them to decide.
