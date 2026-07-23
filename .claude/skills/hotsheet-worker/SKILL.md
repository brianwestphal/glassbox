---
name: hotsheet-worker
description: Run as a distributed worker — continuously claim, work, and release Up Next tickets
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---
<!-- hotsheet-skill-version: 23 -->

You are a **distributed worker** draining the Hot Sheet **Up Next** pool. Multiple workers run in parallel against ONE shared Hot Sheet, each in its own git worktree, coordinated by the atomic claim/lease primitive (docs/90 §90.5) — so you never need to worry about another worker grabbing the same ticket.

**Your worker identity:** derive a stable `worker` id and `label` from your current working directory — use the worktree folder name (the last path segment of your cwd, e.g. `my-repo-feature-x`) for both. This makes your claims attributable in the maintainer's UI.

## The loop

Repeat the following until the pool is empty:

1. **Claim the next ticket.** Call the `hotsheet_claim_next` MCP tool with `{ "worker": "<your-id>", "label": "<your-label>" }`. The default lease is **30 minutes** — plenty for most tickets. Once you've read the ticket and judge it **high-effort** (a big or multi-step change you expect to take a while), claim or immediately renew with a longer `ttlSeconds` (seconds, up to **3600** = 1 hour) so the lease comfortably covers the work.
   - If the response has **`drain: true`**, the worker-pool manager has asked you to shut down (a scale-down). Go straight to **Finishing** — do not claim anything more.
   - If it returns **no ticket** (nothing claimable), the pool is drained — go to **Finishing** below.
   - If it returns a ticket, you now hold an exclusive, time-limited **lease** on it. Continue.
2. **Mark it started.** Call `hotsheet_update_ticket` with `{ "id": <id>, "status": "started" }`.
   - Setting status to `started` also **auto-affirms your claim** under your worker id (HS-9198/9208 — `started` is the *sole* auto-claim trigger; metadata-only edits no longer claim). You already hold the claim from `claim-next`, so this just keeps the ticket attributed to you and write-protected against any *other* actor while you work it. Keep the lease alive by renewing on long work (step 3) and release it when you finish (step 6).
3. **Do the work** described in the ticket details — implement it fully, the same way you would under `/hotsheet`, but for THIS one claimed ticket only.
   - **Heartbeat on long work — don't let the lease lapse while you're heads-down.** You work in long silent bursts (a single big file read + analysis can run minutes), and nothing renews the lease automatically. So **renew proactively**: call `hotsheet_renew_lease` with `{ "id": <id>, "worker": "<your-id>" }` (optionally a larger `ttlSeconds` up to 3600) **before** starting any step you expect to take several minutes, and again any time you've been working a while without renewing. The 30-minute default gives headroom, but treat renewing as a normal part of long work, not an afterthought. If a renew ever returns `{ "ok": false }`, your lease lapsed and the ticket may have been reclaimed by another worker — **stop working it**, do NOT mark it completed, and go back to step 1.
4. **Commit your work** on your worktree's branch with a clear, scoped message referencing the ticket (follow the project's git conventions). Commit only what this ticket touched — don't sweep in unrelated pending changes. **NEVER `git push`** without the maintainer's explicit permission. (You do NOT merge into the target branch yourself — see **Staying in sync** below.)
5. **Complete it.** Call `hotsheet_update_ticket` with `{ "id": <id>, "status": "completed", "notes": "<what you did>" }`. Notes are REQUIRED — describe the specific changes (see the worklist's note-formatting guidance). **If you committed code for this ticket (step 4), also pass `"pending_integration": true` AND `"integration_branch": "<your branch>"`** (your worktree's branch, e.g. `hotsheet/worker-1` — run `git branch --show-current` if unsure) — `pending_integration` marks the ticket "merge pending" in the owner's UI, and `integration_branch` lets the owner review exactly what your branch added before merging. Omit both for tickets with no committed code.
   - **File follow-up tickets** for any incomplete work BEFORE completing (per the project's incomplete-work checklist).
6. **Release the claim.** Call `hotsheet_release` with `{ "id": <id>, "worker": "<your-id>" }` so the slot is freed.
7. **Go back to step 1** and claim the next ticket — **batching small, related tickets** onto the SAME branch (see below) instead of refreshing after every one.

## Batching: amortize the refresh + gates across small, related tickets

Rebasing, reinstalling deps, and running the full gate suite (type-check / lint / the relevant tests) costs about the same whether a ticket is one line or one hundred. So **don't pay it per ticket** — pay it once per **batch**:

- **Keep claiming small, RELATED tickets onto your current branch.** After you commit a ticket (step 4), if the next claimable ticket is **small and related** — shares files/area, the same tag or category, or is a sibling of the same investigation — and your batch is still modest in size/risk, claim it onto the **same** branch and keep working. Do **not** rebase or run the full gates between them.
- **Isolate large or risky tickets.** A big or open-ended change, a migration, or anything touching a hot/shared module gets its **own** branch (a batch of one), so a failure or a nasty conflict stays contained.
- **Keep dependency chains separate.** Never put a ticket in the same batch as one of its own `blocked_by` dependencies — the dependency must integrate first. (`claim-next` already skips blocked tickets, so what you claim is ready to work; just don't co-batch a chain.)
- **Default: batch small/related, isolate large/risky.** Bigger batches save overhead but drift further from the target (a larger conflict surface at integration); smaller batches stay fresher but churn more. Lean toward batching the long tail of small tickets.

At the **batch boundary** — the next claimable ticket is large/unrelated, the pool drains, or the batch has grown enough — refresh + gate **once** (next section), then hand the branch off.

## Staying in sync with the target branch — refresh ONCE at the batch boundary

Your worktree is on its own branch, spun off from the **target branch** (usually `main`). You are **not** the writer of the target — git won't even let your worktree update the target while the owner has it checked out. The main Hot Sheet agent (`/hotsheet`) is the **single integrator** that merges ready worker branches into the target. Your job is to keep your branch current and committed so that integration is clean:

- **Refresh once per batch, on a CLEAN tree** — at the batch boundary (your batch is committed and you're between tickets), bring your branch current in one deterministic pulse: clean-tree guard → `git fetch` (if the repo has a remote) → `git rebase <target>` (e.g. `git rebase main`) → **reinstall deps ONLY if the rebase changed `package-lock.json`/`package.json`** (otherwise your gates run against stale `node_modules` — silently green-but-wrong). This is the §99 `refreshWorktree` routine; do it **once per batch, never mid-ticket** (a dirty tree means commit first).
- **Then run the gates once** over the whole batch (type-check / lint / the relevant tests) before handing off — so the overhead is paid once for the batch, not once per ticket.
- **Resolve trivial rebase conflicts and continue** — for an obvious/mechanical conflict (two unrelated additions, a moved import, a doc line), resolve it sensibly and `git rebase --continue`. For anything non-trivial or ambiguous, **`git rebase --abort`**, leave a `FEEDBACK NEEDED:` note on the relevant ticket describing the conflict, signal done, and wait — do **not** force a risky resolution.
- **Hand off, don't merge** — leave your committed batch on your branch; the owner (`/hotsheet`) is the single integrator and picks up worker branches ahead of the target. You never merge into the target yourself. **Signal the branch ready once per batch** (not per ticket): call `POST /api/workers/ready` with `{ "worker": "<your-id>", "branch": "<your-branch>" }` so the owner integrates it promptly (the owner also scans `hotsheet/*` as a fallback, so this is an optimization, not required).

## Finishing

When `hotsheet_claim_next` returns nothing claimable, the pool is drained — that's a batch boundary. Make sure your work is committed, run the refresh pulse + gates once over the batch (above), signal the branch ready, then call `hotsheet_signal_done` and stop. (The owner / worker-pool manager re-triggers you when there is new work — you do not need to poll.)

## Notes

- **Crash-safety:** if you die mid-ticket, your lease simply expires and another worker reclaims the ticket automatically — nothing to clean up.
- **Dependencies:** `claim-next` already skips tickets blocked by an unfinished `blocked_by` dependency (docs/90 §90.6), so anything you claim is ready to work.
- **Never** work a ticket you have not successfully claimed, and never complete/release a ticket whose lease you have lost.
- If an MCP call fails, fall back to the REST API at `http://localhost:4174/api` (claim-next: `POST /api/tickets/claim-next`; renew: `POST /api/tickets/:id/renew-lease`; release: `POST /api/tickets/:id/release`). Re-read `.hotsheet/settings.json` for the current `port`/`secret` if calls are refused.
