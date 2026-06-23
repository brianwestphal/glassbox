# Integrating AI Tools with Glassbox

> **Audience:** an AI coding tool or agent (Claude Code, Cursor, an autonomous
> agent, a CI bot) working **in a project that uses Glassbox for review** — *not*
> someone hacking on the Glassbox codebase itself (for that, see
> [`CLAUDE.md`](../CLAUDE.md) and [`docs/ai/`](ai/)). This page is the **hub**:
> what you can do, the exact commands, and which deep doc to read for each.

Glassbox is a local, browser-based reviewer for AI-generated code. A human (or an
AI) opens a diff, leaves categorized line feedback, and exports it as structured
markdown an AI tool reads and acts on. As an AI tool you sit on **both sides** of
that loop: you *produce* code + evidence Glassbox reviews, and you *consume* the
feedback Glassbox exports. The integration surfaces below cover the whole loop.

| # | Surface | You… | Mechanism | Deep doc |
| - | --- | --- | --- | --- |
| 1 | **Launch a review** | open a diff for a human/AI to review | `glassbox <mode>` | [2](2-cli-and-server.md), [3](3-git-integration.md), [18](18-direct-comparison.md) |
| 2 | **Write review notes** | record your *rationale / proof* on a line | `glassbox note add …` → `.pr-notes/` | [20](20-ai-review-notes.md) |
| 3 | **Export ground-truth proof** | prove a visual/behavioral change | a `version: 2` manifest → `glassbox --ground-truth` | [26](26-ground-truth-comparison.md), [proof-export-guidance](proof-export-guidance.md) |
| 4 | **Consume feedback** | read & apply the reviewer's annotations | read `.glassbox/latest-review.md` | [6](6-export.md) |
| 5 | **MCP / Claude channel** | get pushed a "apply this feedback" event | `glassbox-channel` MCP server | [17](17-claude-channel.md) |

The CLI is `glassbox` (installed via `npm install -g glassbox`, or run with
`npx glassbox`). It binds to `localhost` only.

---

## 0. What Glassbox is, in one paragraph

A reviewer launches `glassbox` inside a git repo (or against arbitrary paths). It
collects the diff, opens a local web UI, and the reviewer annotates lines with
categorized feedback (`bug`, `fix`, `style`, `pattern-follow`, `pattern-avoid`,
`note`, `remember`). On every annotation change Glassbox regenerates
`.glassbox/latest-review.md` — the structured feedback file your tool reads back.
Two extra channels enrich the review: **AI review notes** (your rationale/proof,
committed in `.pr-notes/`) and **ground-truth image comparison** (visual proof
against a spec/baseline).

---

## 1. Launch a review

Run one of these from inside the project (no server to manage — it starts one and
opens the browser):

```sh
glassbox --uncommitted          # staged + unstaged + untracked (the common case)
glassbox --staged               # only staged
glassbox --commit <sha>         # a specific commit
glassbox --range <from>..<to>   # between two refs
glassbox --branch <name>        # current branch vs <name>
glassbox --files "src/**/*.ts"  # specific globs (comma-separated)
glassbox --all                  # the entire codebase
```

Two modes need **no git repo** (useful for generated output, design specs, build
artifacts):

```sh
glassbox --diff <a> <b>             # compare two arbitrary files or folders (doc 18)
glassbox --ground-truth <manifest>  # image actual-vs-expected review (doc 26)
```

Add `--no-open` to skip launching the browser (e.g. headless/CI), `--port <n>` to
pick a port. Full option list: [doc 2](2-cli-and-server.md) and `glassbox --help`.

**When to launch one:** after you finish a unit of work and want it reviewed, or
when a human asks "let me review that." For unattended pipelines, prefer writing
**review notes** (§2) and **proof** (§3) that ride with the code, then let a human
open the review when convenient.

---

## 2. Write review notes (your rationale & proof)

When you generate or change code, the *why* is usually lost by the time a human
reviews it. Record it as a **line-anchored review note**. Notes are stored as
committed SARIF under `.pr-notes/` (tool-neutral, travels with the repo) and
Glassbox renders them review-comment-style at the exact line. Full spec +
format: [doc 20](20-ai-review-notes.md).

Use the reference producer CLI — it owns the SARIF shape, fingerprinting, and the
`.pr-notes/` layout so you can't get them wrong:

```sh
# Add a note (the body is Markdown; pass - to read it from stdin)
glassbox note add --file src/auth/login.ts --lines 42 --kind rationale \
  --body "Chose argon2id over bcrypt: tunable memory-hardness, and we already pull in the dep." \
  --producer "Claude Code"

# A multi-line range, with a committed proof artifact attached
glassbox note add --file src/api/rate-limit.ts --lines 88-104 --kind proof \
  --body "Load test confirms the limiter holds at 10k req/s." \
  --artifact test-output/ratelimit.log --producer "Claude Code"

glassbox note update --id <guid> --body -      # edit (reads new body from stdin)
glassbox note remove --id <guid>               # delete
glassbox note coalesce                          # drop redundant duplicate notes
glassbox note instructions                      # print the contract to inject into a sub-agent
```

- **`--kind`** is one of: `rationale`, `proof`, `assumption`,
  `alternative-considered`, `risk`, `test-evidence`.
- **`--lines`** is `A` or `A-B`, 1-based. **`--file`** must be inside the repo.
- Optional: `--confidence <0..1>`, `--rank <0..100>`, `--ticket <id|url>`,
  `--producer <name>`, `--producer-version <v>`, and repeatable `--artifact <repo-relative path>`.
- **Commit `.pr-notes/`** alongside the code — that's how the notes reach the
  reviewer (and any other tool). Glassbox warns if `.pr-notes/` is gitignored.
- Run `glassbox note instructions` to get the exact inbound contract to hand to a
  sub-agent that will author notes.

**Textual proof goes here, not in a screenshot.** Logs, computed values, and API
responses belong in a `proof` / `test-evidence` note (optionally via `--artifact`),
attached to the code they prove — never as a ground-truth image of a terminal.

---

## 3. Export ground-truth proof (visual / behavioral)

For changes whose effect is *visible* — a rendered screen, a component, a
multi-step flow — export images and review them as **actual vs expected**
(ground truth): a design spec, a reference render, or a previous baseline. Glassbox
scores the perceptual difference, hides identical pairs, and sorts
most-different-first. Glassbox runs **no capturer** — your test suite writes the
images; Glassbox consumes them via a manifest.

The full how-to (the three proof modalities, suggested layout, animated-SVG flows)
is in **[proof-export-guidance.md](proof-export-guidance.md)**, with a portable,
copy-into-`.claude/skills/` agent skill at
**[`docs/skills/export-review-proof/`](skills/export-review-proof/SKILL.md)**.
The short version:

1. Capture an **actual** PNG/JPEG/SVG per state worth reviewing; pair each with an
   **expected** image (spec / reference / previous-actual baseline).
2. A multi-step flow is either **one animated SVG** (animates live) or **ordered
   per-frame steps** declared as a manifest `set`.
3. Write a `version: 2` manifest (paths relative to the manifest's directory):

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

4. Hand the reviewer `glassbox --ground-truth path/to/manifest.json` (no git repo
   required). For previous-actual regression over a flow, rotate baselines with
   `glassbox ground-truth promote <manifest>` after a reviewed run (it copies
   current actuals over their `previous-actual` baselines; specs/references are
   never overwritten).

`expectedKind` is `spec` | `reference` | `previous-actual` (a display hint, shown
as Spec / Reference / Baseline). Details: [doc 26](26-ground-truth-comparison.md).

---

## 4. Consume the reviewer's feedback

After (and during) a review, Glassbox writes the feedback to:

- **`<repo>/.glassbox/latest-review.md`** — the current review, **overwritten on
  each change** and **auto-regenerated** (2s debounce) as the reviewer annotates,
  so you can read the latest feedback *without* waiting for the review to be
  marked complete.
- **`<repo>/.glassbox/review-<reviewId>.md`** — an archived copy per review.

Read `latest-review.md`, then apply each annotation: edit the referenced
file/line per the feedback, honoring its **category** (`fix`/`bug` are
must-changes; `pattern-avoid`/`pattern-follow` and `remember` are guidance to
internalize — a `remember` item is meant to be persisted into your tool's
durable config such as `CLAUDE.md` / `.cursorrules`). Format spec + the embedded
AI-tool instructions: [doc 6](6-export.md).

**Programmatic consumers** (filing tickets, dashboards) should read the
**structured JSON** companion instead of the prose: `<repo>/.glassbox/latest-review.json`
(+ archive `review-<id>.json`), written alongside the markdown. It groups
annotations by comparison (only annotated ones), with per-comparison ground-truth
context (label / expectedKind / actual+expected paths / difference score / set
grouping) and each region as normalized **and** pixel coordinates + scope. Schema:
`ReviewExportSchema` in `src/api/export.ts` (doc 6 §6.2a).

To act **automatically on completion** with no AI in the loop, launch with a
**completion hook**: `glassbox --ground-truth <manifest> --on-complete "<command>"`.
When the reviewer clicks Complete Review, Glassbox runs `<command>` with
`GLASSBOX_REVIEW_JSON` / `GLASSBOX_REVIEW_MD` / `GLASSBOX_REVIEW_ID` /
`GLASSBOX_REPO_ROOT` in its environment (cwd = repo root). A project ships a small
adapter as `<command>` that reads the JSON and files one ticket per
comparison-with-feedback. This is the generic generalization of §5's channel
button. See doc [2](2-cli-and-server.md) §2.3a.

If your tool was invoked specifically to apply Glassbox feedback (e.g. via the
channel, §5), the canonical action is exactly: **read `.glassbox/latest-review.md`
and apply the feedback.**

---

## 5. MCP / Claude channel (push, not poll)

Instead of polling `latest-review.md`, Glassbox can **push** you a "apply this
feedback" event over MCP. Glassbox ships an MCP channel server
(`glassbox-channel`); when the reviewer enables it, Glassbox registers it in the
project's `.mcp.json` and the completion modal gains a **"Send to Claude"**
button. Clicking it sends a channel event whose content is:

> `Read .glassbox/latest-review.md and apply the feedback.`

If you receive a `glassbox-channel` event, follow its instruction (read the
exported review file named in the event — `latest-review.md`, or an archive path
for a non-current review — and apply the feedback), then signal completion per the
event. Setup, endpoints, and the health/registration model: [doc 17](17-claude-channel.md).

---

## A note on the two AI-doc audiences

- **You are integrating with Glassbox** (this page) → start here, follow the deep
  doc per surface.
- **You are modifying the Glassbox codebase** → read [`CLAUDE.md`](../CLAUDE.md)
  and the maintained summaries in [`docs/ai/`](ai/) (`code-summary.md`,
  `requirements-summary.md`) instead.

Keep this hub in sync when an integration surface changes (a new launch mode, a
`glassbox note` flag, the export path/format, or the channel contract).
