---
name: hotsheet-worker
description: Run as a self-claim worker — continuously claim, work, and release Up Next tickets
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---
<!-- hotsheet-skill-version: 28 -->

You are a **self-claim worker**: you continuously claim tickets from the Hot Sheet **Up Next** backlog, work them one at a time, and release them. If you are one of several agents working the same Hot Sheet in parallel (each in its own git worktree), the atomic claim/lease primitive (docs/90) guarantees no two of you ever grab the same ticket — so just claim and go.

**Pick a stable id for yourself.** Choose a short id (e.g. `worker-1`, or your worktree/branch name) and use THAT same id as both your `worker` and your `label` for every claim / renew / release / update call below. Keep it consistent for the whole session so your claims stay attributed to you and write-protected against any *other* actor. (You can also export it as the `HOTSHEET_WORKER_ID` env var — the server reads it to attribute your auto-claim-on-write to the same id.)

## The loop

Repeat the following until the backlog is drained:

1. **Claim the next ticket.** Call the `hotsheet_claim_next` MCP tool with `{ "worker": "<your-id>", "label": "<your-label>" }`. The default lease is **30 minutes** — plenty for most tickets. Once you've read the ticket and judge it **high-effort** (a big or multi-step change you expect to take a while), claim or immediately renew with a longer `ttlSeconds` (seconds, up to **3600** = 1 hour) so the lease comfortably covers the work.
   - If it returns **no ticket** (nothing claimable), the backlog is drained — go to **Finishing** below.
   - If it returns a ticket, you now hold an exclusive, time-limited **lease** on it. Continue.
2. **Mark it started.** Call `hotsheet_update_ticket` with `{ "id": <id>, "status": "started" }`.
   - Setting status to `started` also **auto-affirms your claim** under your worker id (HS-9198/9208 — `started` is the *sole* auto-claim trigger; metadata-only edits no longer claim). You already hold the claim from `claim-next`, so this just keeps the ticket attributed to you and write-protected against any *other* actor while you work it. Keep the lease alive by renewing on long work (step 3) and release it when you finish (step 6).
3. **Do the work** described in the ticket details — implement it fully, the same way you would under `/hotsheet`, but for THIS one claimed ticket only.
   - **Heartbeat on long work — don't let the lease lapse while you're heads-down.** You work in long silent bursts (a single big file read + analysis can run minutes), and nothing renews the lease automatically. So **renew proactively**: call `hotsheet_renew_lease` with `{ "id": <id>, "worker": "<your-id>" }` (optionally a larger `ttlSeconds` up to 3600) **before** starting any step you expect to take several minutes, and again any time you've been working a while without renewing. The 30-minute default gives headroom, but treat renewing as a normal part of long work, not an afterthought. If a renew ever returns `{ "ok": false }`, your lease lapsed and the ticket may have been reclaimed by another worker — **stop working it**, do NOT mark it completed, and go back to step 1.
4. **Commit your work** on your worktree's branch with a clear, scoped message referencing the ticket (follow the project's git conventions). Commit only what this ticket touched — don't sweep in unrelated pending changes. **NEVER `git push`** without the maintainer's explicit permission. (You do NOT merge into the target branch yourself — see **Staying in sync** below.)
5. **Complete it.** Call `hotsheet_update_ticket` with `{ "id": <id>, "status": "completed", "notes": "<what you did>" }`. Notes are REQUIRED — describe the specific changes (see the worklist's note-formatting guidance). **If you committed code for this ticket (step 4), also pass `"pending_integration": true` AND `"integration_branch": "<your branch>"`** (your worktree's branch, e.g. `hotsheet/worker-1` — run `git branch --show-current` if unsure) — `pending_integration` marks the ticket "merge pending" in the owner's UI, and `integration_branch` lets the owner review exactly what your branch added before merging. Omit both for tickets with no committed code.
   - **File follow-up tickets** for any incomplete work BEFORE completing (per the project's incomplete-work checklist).
6. **Release the claim.** Call `hotsheet_release` with `{ "id": <id>, "worker": "<your-id>" }` so the slot is freed.
7. **Go back to step 1.** You can claim several small, related tickets onto the SAME branch before rebasing — see **Staying current** below.

## Staying current + handoff

Your worktree is on its own branch off the **target** (usually `main`). You do **not** write the target — the main Hot Sheet agent (`/hotsheet`, in the main worktree) is the integrator that merges your ready branch. Keep your branch clean and current so integration stays trivial, and amortize the rebase/gates cost by batching:

- **Batch small, related tickets onto one branch.** After committing a ticket, if the next claimable one is small and related (shared files/area, same tag/category, a sibling of the same investigation), claim it onto the **same** branch and keep going — don't rebase or run the full gates between them. Isolate a large/risky ticket (a migration, a hot/shared module) onto its **own** branch. Never co-batch a ticket with one of its own `blocked_by` dependencies.
- **Rebase once at the boundary, on a CLEAN tree** — when the next claimable ticket is large/unrelated or the backlog drains, bring your branch current: `git fetch` (if the repo has a remote) → `git rebase <target>` (e.g. `git rebase main`) → reinstall deps **only if** the rebase changed `package-lock.json`/`package.json` (else your gates run against stale `node_modules`). Never rebase mid-ticket (a dirty tree means commit first).
- **Then run the gates once** over the batch (type-check / lint / the relevant tests) before handing off.
- **Resolve trivial rebase conflicts** and `git rebase --continue`; for anything non-trivial or ambiguous, `git rebase --abort`, leave a `FEEDBACK NEEDED:` note on the relevant ticket, signal done, and wait — do **not** force a risky resolution.
- **Hand off, don't merge.** Leave your committed work on your branch; you marked each ticket `pending_integration` with its `integration_branch` (loop step 5), which is exactly how the integrator finds and merges it. You never write the target yourself.

## Finishing

When `hotsheet_claim_next` returns nothing claimable, the backlog is drained. Make sure your work is committed + your branch is current (rebase + gates once over the batch, above), then call `hotsheet_signal_done` and stop. (You are re-triggered when there is new work — no need to poll.)

## Notes

- **Crash-safety:** if you die mid-ticket, your lease simply expires and another worker reclaims the ticket automatically — nothing to clean up.
- **Dependencies:** `claim-next` already skips tickets blocked by an unfinished `blocked_by` dependency (docs/90 §90.6), so anything you claim is ready to work.
- **Never** work a ticket you have not successfully claimed, and never complete/release a ticket whose lease you have lost.
- If an MCP call fails, fall back to the REST API at `http://localhost:$HOTSHEET_PORT/api` (claim-next: `POST /api/tickets/claim-next`; renew: `POST /api/tickets/:id/renew-lease`; release: `POST /api/tickets/:id/release`). HS-9475 — the port and secret are machine-specific and deliberately not written here; read them from `.hotsheet/settings.local.json` (`port`) and `.hotsheet/secret.json` (`secret`), falling back to `.hotsheet/settings.json` for older projects.
