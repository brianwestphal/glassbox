---
name: check-requirements-against-code
description: Check requirements docs against implementation, report discrepancies and gaps
allowed-tools: Read, Grep, Glob, Bash, Edit, Agent
---

Check the requirements documents against the actual implementation, verify the AI-oriented summaries still match reality, and confirm the CLAUDE.md index is complete. Generate a report with recommendations and questions about any discrepancies.

## Process

1. **Read all requirements documents** in `docs/` (numbered files like `1-review-workflow.md` through `17-claude-channel.md`). Each contains functional (FR-) and non-functional (NFR-) requirements.

2. **For each requirement**, verify the implementation exists:
   - Search the codebase (`src/`) for the relevant code
   - Check that the behavior described in the requirement is actually implemented
   - Note any partial implementations or deviations from the spec

3. **Check for undocumented features**: Look for significant functionality in the code that isn't covered by any requirement. These may be intentional additions that need documentation, or accidental scope creep.

4. **Synchronize the AI summaries** (`docs/ai/code-summary.md` and `docs/ai/requirements-summary.md`):
   - Open both files and verify they reflect the current state of the tree.
   - For `code-summary.md`: walk through each section and confirm it matches what's actually in `src/`, `src-tauri/`, `scripts/`, and the database schema. Look specifically for:
     - Files/folders listed that no longer exist
     - Files/folders in the tree that aren't mentioned
     - Routes in the catalog that no longer exist (or new ones missing)
     - Database tables/columns that don't match `src/db/schema.ts`
     - External deps in §14 that don't match `tsup.config.ts` and `scripts/build-sidecar.sh`
     - Any entry in the "Where do I look to…" reverse index that points at a renamed or moved file
   - For `requirements-summary.md`: confirm every requirements doc in `docs/` has a section, the section number matches the doc number, and the status marker (Shipped / Partially built / Design only / Deferred / Superseded) still reflects reality based on what you found in step 2.
   - If you find drift, fix it directly — this skill has the `Edit` tool for exactly this reason. Don't just report the drift; update the summaries so they're correct when you're done.

5. **Verify the CLAUDE.md index is complete**:
   - Read `CLAUDE.md` and find the requirements index (the bulleted list under the "Requirements documents" heading that names each `docs/N-topic.md`).
   - Cross-check against the actual list of numbered docs in `docs/` (via `Glob` on `docs/*-*.md`).
   - Every numbered requirements doc must appear in the index with the correct filename and a one-line description. Every entry in the index must correspond to a real file.
   - Also verify the AI summaries block (the section pointing at `docs/ai/code-summary.md` and `docs/ai/requirements-summary.md`) is present and accurate.
   - If you find missing, stale, or mis-named entries, fix them directly in `CLAUDE.md`.

6. **Generate the report** with these sections:

   ### Requirements Coverage Report

   **Fully Implemented** — Requirements that are correctly implemented (brief list)

   **Partially Implemented** — Requirements where the implementation exists but is incomplete or deviates:
   - Requirement ID and description
   - What's implemented vs what's missing
   - Recommendation

   **Not Implemented** — Requirements with no corresponding implementation:
   - Requirement ID and description
   - Recommendation (implement, defer, or remove from requirements)

   **Undocumented Features** — Code functionality not covered by requirements:
   - Feature description and location
   - Recommendation (document or remove)

   **Summary & Index Synchronization** — What you changed (or confirmed correct) in:
   - `docs/ai/code-summary.md`
   - `docs/ai/requirements-summary.md`
   - `CLAUDE.md` requirements index and AI-summaries section

   **Questions** — Ambiguities or contradictions found:
   - The specific requirement(s) involved
   - The question or concern

Present the report directly to the user. Focus on actionable findings — skip trivially correct implementations. If the summaries and index were already in sync, say so in one line rather than padding the report.
