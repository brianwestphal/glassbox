# AGENTS.md

Guidance for AI coding agents. There are **two distinct audiences** — pick yours:

## You are modifying the Glassbox codebase

Read **[`CLAUDE.md`](CLAUDE.md)** (project overview, architecture, conventions,
the ticket-driven workflow, testing) and the maintained AI summaries in
**[`docs/ai/`](docs/ai/)**:

- [`docs/ai/code-summary.md`](docs/ai/code-summary.md) — codebase map (directory
  tree, routes, schema, client modules, "where do I look for X").
- [`docs/ai/requirements-summary.md`](docs/ai/requirements-summary.md) —
  synthesized requirements with status markers.

Read those before diving into source. Run `npm test`, `npm run lint`, and
`npm run typecheck` before finishing; keep the requirements docs + AI summaries in
sync with code changes.

## You are integrating *with* Glassbox from your own project

You are an AI tool in a project that **uses** Glassbox to review your work. Read
**[`docs/ai-integration.md`](docs/ai-integration.md)** — the full hub. Quick map:

| You want to… | Do this | Doc |
| --- | --- | --- |
| Open a diff for review | `glassbox --uncommitted` (or `--commit`/`--branch`/`--files`/`--diff`/`--ground-truth`) | [2](docs/2-cli-and-server.md), [18](docs/18-direct-comparison.md) |
| Record your rationale/proof on a line | `glassbox note add --file <p> --lines <A[-B]> --kind <k> --body <text\|->` → commit `.pr-notes/` | [20](docs/20-ai-review-notes.md) |
| Prove a visual/behavioral change | write a `version: 2` manifest, run `glassbox --ground-truth <manifest>` | [26](docs/26-ground-truth-comparison.md), [proof-export-guidance](docs/proof-export-guidance.md) |
| Apply the reviewer's feedback | read `<repo>/.glassbox/latest-review.md` (prose) and act on each annotation by category | [6](docs/6-export.md) |
| Consume feedback programmatically | read the structured `<repo>/.glassbox/latest-review.json` (annotations grouped by comparison, region pixel coords, ground-truth context) | [6](docs/6-export.md) |
| Act automatically on completion | launch with `--on-complete "<cmd>"`; `<cmd>` runs at Complete Review with `GLASSBOX_REVIEW_JSON`/`_MD`/`_ID`/`GLASSBOX_REPO_ROOT` in env (e.g. file tickets, no AI in the loop) | [2](docs/2-cli-and-server.md) §2.3a |
| Get feedback pushed to you | respond to the `glassbox-channel` MCP event: read `latest-review.md`, apply | [17](docs/17-claude-channel.md) |

The CLI is `glassbox` (`npm install -g glassbox`, or `npx glassbox`); it binds to
`localhost` only. Textual proof (logs, values) belongs in a `proof`/`test-evidence`
review **note**, not a screenshot. See [`docs/ai-integration.md`](docs/ai-integration.md)
for the exact commands, flags, and contracts.

<!-- hotsheet:begin section=claude-adapter v=1 -->
## Shared Project Guidance (CLAUDE.md)

`CLAUDE.md` is the shared source of truth for this repository's engineering rules. Read it completely before making or reviewing changes, and follow it as if its contents appeared here. The filename reflects the project's history; the instructions apply equally to this tool.

- Project workflows are exposed as skills under `.agents/skills/`. Use a skill when the user names it or the request clearly matches its description.
- The skill adapters delegate to `.claude/skills/`, the canonical source for workflows shared across AI tools. When changing a shared workflow, edit the canonical file and keep the adapter metadata in sync.
- Claude tool names in shared documents describe capabilities, not required product-specific tools — use this tool's equivalent file-search, shell, editing, or web capability.
- Keep durable repository guidance in `CLAUDE.md`; provider-specific configuration belongs in its provider's directory.
<!-- hotsheet:end section=claude-adapter -->
