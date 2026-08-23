---
name: ux-review
description: Ruthless Principal-Designer UI/UX review of Glassbox screens/flows — capture screenshots, apply HCI heuristics, compare notes with codex, file tickets for issues
allowed-tools: Read, Grep, Glob, Bash, Agent
---

Run a critical UI/UX review of one or more Glassbox screens/flows, cross-check it
against a second model (codex), and file Hot Sheet tickets for the findings. Use
this both for a broad sweep of all screens and whenever the maintainer asks to
review a specific screen/flow/operation.

## The review lens (apply verbatim)

Act as a **ruthless, elite Principal Product Designer and UX Researcher**. Review
the interface. Evaluate strictly using industry heuristics, HCI principles, and
modern design systems. Do NOT just praise the aesthetic — give deep, critical
feedback across these exact categories:

- **Visual Hierarchy & Layout** — focal points, grid alignment, whitespace,
  scanning patterns (F/Z), and whether primary actions stand out from secondary.
- **UX Friction & Cognitive Load** — unnecessary steps, confusing flows,
  ambiguous icons, hidden navigation, cognitive overload on this specific screen.
- **Accessibility (a11y) & Readability** — contrast ratios (WCAG AA: 4.5:1 text,
  3:1 large text / UI), tap-target sizes (≥ 44–48px where pointer/touch), font
  sizing/scaling, legibility. (Glassbox is a desktop web/Tauri app — weight touch
  targets accordingly, but keep keyboard focus + contrast front and center.)
- **Microcopy & Content Strategy** — button labels/CTAs, helper text, empty-state
  messaging, error states: clarity, tone, actionability.

Format each screen's findings as:

- **The Good** — what works and should be kept.
- **Critical Issues** — ranked highest→lowest severity by user impact.
- **Actionable Recommendations** — specific, practical fixes; no guessing. Tie
  each to the code location that would change it (component / SCSS partial).

## Process

### 1. Pick the scope

- **Specific screen/flow** (maintainer asked for one): just that surface.
- **Full sweep**: the screens below. It's a lot — do a representative batch per
  run and note the rest as a follow-up rather than a shallow pass over all.

### 2. Capture what you're reviewing (screenshots — review pixels, not just markup)

Boot the demo server on a disposable config dir, then screenshot with Playwright
into the scratchpad. The demo (`src/demo.ts`) has rich, deterministic data.

```bash
# Kill stale e2e ports first (the playwright webServers use 4183-4188).
for p in 4183 4184 4185; do lsof -ti tcp:$p | xargs -r kill -9 2>/dev/null; done
# Boot a demo server on an isolated config dir (never touches ~/.glassbox).
GLASSBOX_CONFIG_DIR="$TMPDIR/ux-review-cfg" \
  npx tsx src/cli.ts --demo:1 --ai-service-test --no-open --strict-port --port 4183 &
```

Demo scenarios (`--demo:N`) map to screens:

| N | Screen / flow it surfaces |
|---|---|
| 1 | Main review UI, folder sort, guided review notes |
| 2 | Risk sort mode + inline risk notes + risk dimension popover |
| 3 | Narrative sort mode + walkthrough notes |
| 4 | Annotations of every category (the annotation form + rows) |
| 5 | Settings dialog (guided review on) — also open Profile/Experimental/Plugins tabs, theme manager, theme editor |
| 6 | Direct comparison (`--diff`) two-folder review |
| 7 | AI review notes inline (rationale/proof/risk/threading), image-note artifacts |

Also reach: the **completion modal** (click Complete Review), **history** (`/history`),
**image comparison** (a binary image file → Metadata/A/B/Side-by-Side/Difference/Slice),
and the desktop **welcome/setup** screen (Tauri only — screenshot from `src-tauri/`
loading assets or describe from source if no desktop build).

Write a throwaway Playwright script in the scratchpad that navigates + screenshots
each target to `…/scratchpad/ux/<screen>.png` (full page and, for dense areas,
element clips). Then Read the PNGs to review them. Do NOT commit screenshots.

### 3. Review with the lens (§ above)

Produce the three-part findings per screen. Ground every claim in the pixels +
the code: check real contrast against the theme tokens in
`src/client/styles/_variables.scss`, real control sizes in the SCSS, and real
copy in the components. Name the file that would change for each fix.

### 4. Ask codex for the same review and compare notes

Run codex non-interactively against the same screenshots + lens, then reconcile.

```bash
codex exec --skip-git-repo-check -C "$PWD" - <<'PROMPT'
Act as a ruthless, elite Principal Product Designer and UX Researcher. Review the
Glassbox UI screenshots at <absolute scratchpad/ux/*.png paths>. <paste the 4
categories + output format from the lens above.> Be specific and cite what you see.
PROMPT
```

(If codex can't open the images in this environment, fall back to having it review
the relevant components/SCSS by path, and say so in the comparison.) Then write a
short **Comparison** section: where you and codex **agree** (high-confidence —
prioritize these), where you **disagree** (note both, pick a side with reasoning),
and anything **only one** of you caught.

### 5. File tickets

For each **Critical Issue** and each **Actionable Recommendation**:

- File a ticket (prefer `hs-bug` for defects / `hs-task` or `hs-feature` for
  improvements, or the `hotsheet_create_ticket` tool). Title = the fix; details =
  the finding + severity + the category + the code location + whether you and
  codex agreed. One ticket per distinct fix; group tightly-related nits.
- **If you're unsure** whether a change is wanted (subjective taste, a redesign
  with tradeoffs, or a fix that could regress a deliberate choice): still file the
  ticket, set it `started`, add a **`FEEDBACK NEEDED:`** note stating the specific
  question, and (in a channel run) signal done + wait — do not implement it.
- Cross-reference this review pass (GB-1163) in the ticket so the batch is traceable.
- Do NOT implement fixes in this skill run unless the maintainer said to — this
  skill produces the review + tickets; implementation is separate work.

### 6. Keep the design tokens honest

When a finding is about contrast/spacing/sizing, verify against the source of
truth rather than eyeballing: `src/client/styles/_variables.scss` (theme tokens),
the per-concern `_*.scss` partials, and `src/themes/built-in.ts` (the shipped
themes — a contrast issue may be theme-specific).

## Where each screen lives (code map for fixes)

- Main shell / layout — `src/components/reviewShell.tsx`, `src/client/styles/_base.scss`
- Sidebar / file list / sort control — `src/client/sidebar/`, `_sidebar.scss`, `_ai-sort.scss`
- Diff view / toolbar — `src/components/diffView.tsx`, `src/client/diff/`, `_diff.scss`
- Annotations — `src/client/annotations/`, `_annotations.scss`
- Completion modal — `src/client/review/modal.tsx`, `_modal.scss`
- Settings / theme manager+editor / plugins tab — `src/client/settings/`, `_settings.scss`
- History — `src/components/reviewHistory.tsx`, `src/client/history.tsx`, `_history.scss`
- Image comparison — `src/components/imageDiff.tsx`, `src/client/diff/imageDiff/`, `_image-diff.scss`
- Buttons / shared — `_buttons.scss`; icons — `src/icons.tsx`; colors — `_variables.scss`

## Notes

- Glassbox is a **local, single-user desktop-oriented** app (browser + Tauri), so
  weight desktop pointer + keyboard over mobile touch — but still flag contrast,
  focus-visibility, and copy issues, which matter regardless.
- Themes: check findings against at least the default **Dark** and **Light**
  themes (and High Contrast for a11y) — a contrast problem may exist in one only.
- This skill is read-only + ticket-filing. Screenshots are scratch; never commit them.
