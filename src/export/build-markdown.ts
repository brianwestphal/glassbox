/**
 * Pure markdown assembly for the review export (doc 6) — split out of
 * `generate.ts` the same way the JSON companion lives in `build-data.ts`, so
 * the generator is just data collection + IO. No filesystem or DB access here.
 */
import type { Annotation, Review, ReviewFile } from '../db/queries.js';
import type { Attachment } from '../db/schemas.js';

export interface MarkdownExportArgs {
  review: Review;
  files: ReviewFile[];
  /** Annotations joined with their file path, in render order. */
  annotations: (Annotation & { file_path: string })[];
  /** Attachments grouped by the annotation they hang off (doc 25). */
  attachmentsByAnnotation: Record<string, Attachment[]>;
  /** Clean short mode label (never the raw serialized mode string — GB-971). */
  modeLabel: string;
  /** ISO export timestamp. */
  date: string;
  /** Pre-rendered AI review-note section lines (doc 20 §20.8, P5); may be empty. */
  reviewNoteLines: string[];
  /** Anchor label for one annotation (line / image / region form). */
  anchorLabel: (a: { line_number: number; region_data: string | null }) => string;
}

/** Build the complete `latest-review.md` markdown body. */
export function buildReviewMarkdown(args: MarkdownExportArgs): string {
  const { review, files, annotations, attachmentsByAnnotation, modeLabel, date, reviewNoteLines, anchorLabel } = args;

  // Group annotations by file
  const byFile: Record<string, typeof annotations> = {};
  for (const a of annotations) {
    (byFile[a.file_path] ??= []).push(a);
  }

  const lines: string[] = [];

  lines.push('# Code Review');
  lines.push('');
  lines.push(`- **Repository**: ${review.repo_name}`);
  lines.push(`- **Review mode**: ${modeLabel}`);
  lines.push(`- **Review ID**: ${review.id}`);
  lines.push(`- **Date**: ${date}`);
  lines.push(`- **Files reviewed**: ${files.filter(f => f.status === 'reviewed').length}/${files.length}`);
  lines.push(`- **Total annotations**: ${annotations.length}`);
  lines.push('');

  // Summary of categories
  const categoryCounts: Record<string, number> = {};
  for (const a of annotations) {
    categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
  }
  if (Object.keys(categoryCounts).length > 0) {
    lines.push('## Annotation Summary');
    lines.push('');
    for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`- **${cat}**: ${count}`);
    }
    lines.push('');
  }

  // Items tagged "remember" should be prominent for AI tools
  const rememberItems = annotations.filter(a => a.category === 'remember');
  if (rememberItems.length > 0) {
    lines.push('## Items to Remember');
    lines.push('');
    lines.push('> These annotations are flagged for long-term retention. AI tools should consider updating');
    lines.push('> project configuration (CLAUDE.md, .cursorrules, etc.) with these preferences/rules.');
    lines.push('');
    for (const item of rememberItems) {
      const anchor = item.line_number === 0 ? `${item.file_path} (image)` : `${item.file_path}:${item.line_number}`;
      lines.push(`- **${anchor}** - ${item.content}`);
    }
    lines.push('');
  }

  // Per-file annotations
  lines.push('## File Annotations');
  lines.push('');

  for (const filePath of Object.keys(byFile).sort()) {
    const fileAnns = byFile[filePath];
    lines.push(`### ${filePath}`);
    lines.push('');
    for (const a of fileAnns) {
      lines.push(`- ${anchorLabel(a)} [${a.category}]: ${a.content}`);
      const atts = attachmentsByAnnotation[a.id] ?? [];
      if (atts.length > 0) {
        lines.push('  - Attachments (readable files on disk):');
        for (const at of atts) lines.push(`    - \`${at.stored_path}\` (${at.original_filename})`);
      }
    }
    lines.push('');
  }

  // AI-authored review notes from `.pr-notes/` (docs/20 §20.8, P5).
  if (reviewNoteLines.length > 0) lines.push(...reviewNoteLines);

  // Instructions for AI tools
  lines.push('---');
  lines.push('');
  lines.push('## Instructions for AI Tools');
  lines.push('');
  lines.push('When processing this code review:');
  lines.push('');
  lines.push('1. **bug** and **fix** annotations indicate code that needs to be changed. Apply the suggested fixes.');
  lines.push('2. **style** annotations indicate stylistic preferences. Apply them to the indicated lines and similar patterns nearby.');
  lines.push('3. **pattern-follow** annotations highlight good patterns. Continue using these patterns in new code.');
  lines.push('4. **pattern-avoid** annotations highlight anti-patterns. Refactor the indicated code and avoid the pattern elsewhere.');
  lines.push('5. **remember** annotations are rules/preferences to persist. Update the project\'s AI configuration file (e.g., CLAUDE.md) with these.');
  lines.push('6. **note** annotations are informational context. Consider them but they may not require code changes.');
  lines.push('7. **Attachments** listed under an annotation are real files on disk (screenshots, logs, specs, etc.) — read them from the given path for additional context when acting on that comment.');
  lines.push('');

  return lines.join('\n');
}
