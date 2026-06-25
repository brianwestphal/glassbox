---
name: hotsheet
description: Read the Hot Sheet worklist and work through the current priority items
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---
<!-- hotsheet-skill-version: 17 -->

Read `.hotsheet/worklist.md` and work through the tickets in priority order.

For each ticket:
1. Read the ticket details carefully
2. Implement the work described
3. When complete, mark it done via the Hot Sheet UI

Work through them in order of priority, where reasonable.

If the worklist says "Auto-Prioritize", follow those instructions to choose and mark tickets as Up Next before working on them.

If API calls fail (connection refused or 403), re-read `.hotsheet/settings.json` for the current `port` and `secret` values — you may be connecting to the wrong Hot Sheet instance.

**MCP tools (`hotsheet_*`) are preferred over curl when the channel is connected** — see the worklist for per-operation guidance. The 14-tool surface covers ticket lifecycle (`hotsheet_update_ticket`, `hotsheet_create_ticket`, `hotsheet_get_ticket`, `hotsheet_delete_ticket`, `hotsheet_restore_ticket`, `hotsheet_toggle_up_next`, `hotsheet_duplicate_tickets`), bulk operations (`hotsheet_batch`), notes (`hotsheet_edit_note`, `hotsheet_delete_note`), attachments (`hotsheet_add_attachment`), channel signaling (`hotsheet_signal_done`), feedback sugar (`hotsheet_request_feedback`), and query (`hotsheet_query_tickets`). Curl stays supported as the universal fallback for non-Claude AI agents and human terminal callers.

## Git: keep the target current + integrate worker branches

You run on the **target branch** (usually `main`) in the main worktree, so you are the **single integrator** for parallel worktree workers (docs/89). Distributed workers (`/hotsheet-worker`) commit their work on their own branches and rebase onto the target to stay current, but they never write the target — that's your job:

- **Stay current** — before integrating, bring the target up to date: `git fetch` then `git pull --rebase` (or rebase onto the upstream) when the repo has a remote, so you build on the latest. Commit or stash your own in-progress changes first so a merge doesn't tangle with them.
- **Integrate ready worker branches** — periodically (e.g. when a batch of workers has finished, or the pool drains). Use the **integration helpers** (HS-9048) rather than hand-rolling the git: `GET /api/workers/integratable` returns the detected **target** branch + the **ready** worker branches (`hotsheet/*` ahead of the target, with ahead/behind counts); then for each, in ticket-priority order, `POST /api/workers/integrate` with `{ "branch": "<name>" }` does a guarded merge into the target. It returns a `status`: `merged` (success), `conflict` (it captured the conflicted files + **aborted** cleanly — resolve them by hand or, if non-trivial, ask the maintainer), `dirty-tree` (commit/stash your own changes first), `not-on-target` / `nothing-to-integrate`. After a `merged`, run the project's gates (type-check, lint, the relevant tests). The helper **never pushes** — pushing still needs explicit permission.
- For each ticket whose work you just integrated, clear its "merge pending" marker: `hotsheet_update_ticket` with `{ "id": <id>, "pending_integration": false }` (the tickets marked `pending_integration` are the ones awaiting integration).
- **Sensible conflict resolution, ask on the hard ones** — auto-resolve trivial/mechanical conflicts; if a conflict is non-trivial or ambiguous, or the gates fail in a way you can't quickly and safely fix, **stop and ask the maintainer** rather than force it (leave the branch unmerged). Integrate only from committed branch state — never disturb a worker mid-ticket.
- **NEVER `git push`** without the maintainer's explicit permission — local integration only.
