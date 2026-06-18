/**
 * The **inbound** AI-instructions contract for AI-Authored Review Notes
 * (docs/20 §20.4 + §20.7) — the symmetric counterpart to Glassbox's *outbound*
 * instructions (the export's "act on this feedback" text and the per-tool
 * skill files in `src/skills.ts`).
 *
 * This is the canonical, single-source text telling a *generating* AI when and
 * how to emit review notes. It's surfaced via `glassbox note instructions` so
 * any orchestrator (Hot Sheet, a Claude Code skill, any agent runner) can run
 * the command and inject the output into the coding AI's context — rather than
 * each tool forking its own wording, which would drift from the actual
 * `glassbox note` CLI surface.
 */
import { NOTE_KINDS } from './types.js';

/** The canonical inbound instruction text (Markdown). */
export function reviewNoteInstructions(): string {
  return [
    '# Emitting AI review notes (`.pr-notes/`)',
    '',
    'As you write or change code, leave **line-anchored review notes** that explain',
    'your reasoning and prove your work — the rationale a careful reviewer (human or',
    'the next AI session) would want, anchored to the exact lines it concerns. Notes',
    'are committed to the repo as tool-neutral SARIF under `.pr-notes/` and shown',
    'review-comment-style in Glassbox. Write them **while editing**, at the moment of',
    'richest context — not reconstructed afterward.',
    '',
    '## When to emit a note',
    '',
    'Emit one when a future reader would otherwise have to ask "why?". Good triggers:',
    '',
    '- A **non-obvious decision** — why this approach over the obvious one.',
    '- **Proof** a change is correct — the reasoning, test output, or invariant that backs it.',
    '- An **assumption** you relied on that could later be wrong.',
    '- An **alternative you considered and rejected**, and why.',
    '- A **risk** or sharp edge a reviewer should scrutinize.',
    '- **Test evidence** demonstrating the change works.',
    '',
    'Do **not** narrate the obvious or restate what the diff already says. One note per',
    'genuine decision or claim — not per line.',
    '',
    '## How to emit a note',
    '',
    'Shell out to the `glassbox note` CLI (it owns the on-disk format, fingerprint,',
    'and commit provenance — you never write the SARIF by hand):',
    '',
    '```',
    'glassbox note add \\',
    '  --file <repo-relative path> \\',
    '  --lines <A[-B]> \\',
    `  --kind <${NOTE_KINDS.join('|')}> \\`,
    '  --body - \\            # body read from stdin (use --body "text" for short notes)',
    '  [--confidence 0..1] [--rank 0..100] [--ticket <id|url>] \\',
    '  [--producer "<your tool/agent name>"] [--producer-version <v>]',
    '```',
    '',
    'Always set `--producer` so the note records who wrote it, and `--ticket` when the',
    'work traces to a tracked task. Keep the body focused: the claim and its support.',
    '',
    '## Revise and consolidate',
    '',
    'Notes should reflect the **final** state of your change, not an obsolete',
    'intermediate step:',
    '',
    '- `glassbox note add` prints a stable note id (guid).',
    '- `glassbox note update --id <guid> [--body -|--kind …|--confidence …|--rank …|--ticket …]`',
    '  to correct a note as the work evolves.',
    '- `glassbox note remove --id <guid>` to drop one that no longer applies.',
    '- When the task is done, run `glassbox note coalesce` to drop redundant notes',
    '  (identical anchor + kind + body, keeping the most recent).',
    '',
    "If your tool can't shell out, write the SARIF directly under `.pr-notes/` per the",
    'format in `docs/20-ai-review-notes.md` — but prefer the CLI.',
  ].join('\n');
}
