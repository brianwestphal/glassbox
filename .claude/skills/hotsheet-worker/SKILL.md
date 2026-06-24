---
name: hotsheet-worker
description: Run as a distributed worker — continuously claim, work, and release Up Next tickets
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---
<!-- hotsheet-skill-version: 13 -->

You are a **distributed worker** draining the Hot Sheet **Up Next** pool. Multiple workers run in parallel against ONE shared Hot Sheet, each in its own git worktree, coordinated by the atomic claim/lease primitive (docs/90 §90.5) — so you never need to worry about another worker grabbing the same ticket.

**Your worker identity:** derive a stable `worker` id and `label` from your current working directory — use the worktree folder name (the last path segment of your cwd, e.g. `my-repo-feature-x`) for both. This makes your claims attributable in the maintainer's UI.

## The loop

Repeat the following until the pool is empty:

1. **Claim the next ticket.** Call the `hotsheet_claim_next` MCP tool with `{ "worker": "<your-id>", "label": "<your-label>" }`.
   - If the response has **`drain: true`**, the worker-pool manager has asked you to shut down (a scale-down). Go straight to **Finishing** — do not claim anything more.
   - If it returns **no ticket** (nothing claimable), the pool is drained — go to **Finishing** below.
   - If it returns a ticket, you now hold an exclusive, time-limited **lease** on it. Continue.
2. **Mark it started.** Call `hotsheet_update_ticket` with `{ "id": <id>, "status": "started" }`.
3. **Do the work** described in the ticket details — implement it fully, the same way you would under `/hotsheet`, but for THIS one claimed ticket only.
   - **Heartbeat on long work:** if the work takes a while, periodically call `hotsheet_renew_lease` with `{ "id": <id>, "worker": "<your-id>" }` to keep your lease fresh. If a renew ever returns `{ "ok": false }`, your lease lapsed and the ticket may have been reclaimed by another worker — **stop working it**, do NOT mark it completed, and go back to step 1.
4. **Complete it.** Call `hotsheet_update_ticket` with `{ "id": <id>, "status": "completed", "notes": "<what you did>" }`. Notes are REQUIRED — describe the specific changes (see the worklist's note-formatting guidance).
   - **File follow-up tickets** for any incomplete work BEFORE completing (per the project's incomplete-work checklist).
5. **Release the claim.** Call `hotsheet_release` with `{ "id": <id>, "worker": "<your-id>" }` so the slot is freed.
6. **Go back to step 1** and claim the next ticket.

## Finishing

When `hotsheet_claim_next` returns nothing claimable, the pool is drained. Call `hotsheet_signal_done` and stop. (The owner / worker-pool manager re-triggers you when there is new work — you do not need to poll.)

## Notes

- **Crash-safety:** if you die mid-ticket, your lease simply expires and another worker reclaims the ticket automatically — nothing to clean up.
- **Dependencies:** `claim-next` already skips tickets blocked by an unfinished `blocked_by` dependency (docs/90 §90.6), so anything you claim is ready to work.
- **Never** work a ticket you have not successfully claimed, and never complete/release a ticket whose lease you have lost.
- If an MCP call fails, fall back to the REST API at `http://localhost:4174/api` (claim-next: `POST /api/tickets/claim-next`; renew: `POST /api/tickets/:id/renew-lease`; release: `POST /api/tickets/:id/release`). Re-read `.hotsheet/settings.json` for the current `port`/`secret` if calls are refused.
