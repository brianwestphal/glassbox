import { spawnSync } from 'child_process';
import { appendFileSync,existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';

import { getAnnotationsForReview,getReview, getReviewFiles } from '../db/queries.js';
import { ImageRegionSchema } from '../db/schemas.js';
import { isGitRepo } from '../git/repo.js';
import { reviewNotesExportSection } from '../review-notes/format.js';

const DISMISS_FILE = join(homedir(), '.glassbox', 'gitignore-dismissed.json');
const DISMISS_DAYS = 30;

// repoRoot → dismissal timestamp (ms). Validated at read time rather than cast.
const DismissalsSchema = z.record(z.string(), z.number());

function loadDismissals(): Record<string, number> {
  try {
    const parsed = DismissalsSchema.safeParse(JSON.parse(readFileSync(DISMISS_FILE, 'utf-8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function saveDismissals(data: Record<string, number>): void {
  const dir = join(homedir(), '.glassbox');
  mkdirSync(dir, { recursive: true });
  writeFileSync(DISMISS_FILE, JSON.stringify(data), 'utf-8');
}

export function isGlassboxGitignored(repoRoot: string): boolean {
  // Use git check-ignore to see if .glassbox is ignored
  const result = spawnSync('git', ['check-ignore', '-q', '.glassbox'], { cwd: repoRoot, stdio: 'pipe' });
  return result.status === 0;
}

export function shouldPromptGitignore(repoRoot: string): boolean {
  // Direct comparison (doc 18, FR-18.8) can run outside a repo — there's no
  // .gitignore to manage, so never prompt.
  if (!isGitRepo(repoRoot)) return false;
  if (isGlassboxGitignored(repoRoot)) return false;
  const dismissals = loadDismissals();
  const dismissed = dismissals[repoRoot];
  if (dismissed) {
    const daysSince = (Date.now() - dismissed) / (1000 * 60 * 60 * 24);
    if (daysSince < DISMISS_DAYS) return false;
  }
  return true;
}

export function addGlassboxToGitignore(repoRoot: string): void {
  const gitignorePath = join(repoRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.endsWith('\n')) {
      appendFileSync(gitignorePath, '\n.glassbox/\n', 'utf-8');
    } else {
      appendFileSync(gitignorePath, '.glassbox/\n', 'utf-8');
    }
  } else {
    writeFileSync(gitignorePath, '.glassbox/\n', 'utf-8');
  }
}

export function dismissGitignorePrompt(repoRoot: string): void {
  const dismissals = loadDismissals();
  dismissals[repoRoot] = Date.now();
  saveDismissals(dismissals);
}

export function deleteReviewExport(reviewId: string, repoRoot: string): void {
  const exportDir = join(repoRoot, '.glassbox');
  const archivePath = join(exportDir, `review-${reviewId}.md`);
  if (existsSync(archivePath)) unlinkSync(archivePath);
}

/**
 * The anchor label for an annotation in the markdown export. Line annotations
 * read `**Line N**`; image-level annotations (doc 23, `line_number === 0`) read
 * `**Image region (x%, y%, w%×h%)**` when anchored to a rectangle, or
 * `**Image comment**` for a general comment.
 */
function annotationAnchorLabel(a: { line_number: number; region_data: string | null }): string {
  if (a.line_number !== 0) return `**Line ${a.line_number}**`;
  if (a.region_data !== null) {
    const parsed = ImageRegionSchema.safeParse(JSON.parse(a.region_data) as unknown);
    if (parsed.success) {
      const { x, y, w, h } = parsed.data;
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      return `**Image region (${pct(x)}, ${pct(y)}, ${pct(w)}×${pct(h)})**`;
    }
  }
  return '**Image comment**';
}

export async function generateReviewExport(reviewId: string, repoRoot: string, isCurrent: boolean): Promise<string> {
  const review = await getReview(reviewId);
  if (!review) throw new Error('Review not found');

  const files = await getReviewFiles(reviewId);
  const annotations = await getAnnotationsForReview(reviewId);

  const exportDir = join(repoRoot, '.glassbox');
  mkdirSync(exportDir, { recursive: true });

  // Group annotations by file
  const byFile: Record<string, typeof annotations> = {};
  for (const a of annotations) {
    if (!(a.file_path in byFile)) byFile[a.file_path] = [];
    byFile[a.file_path].push(a);
  }

  const lines: string[] = [];

  lines.push('# Code Review');
  lines.push('');
  lines.push(`- **Repository**: ${review.repo_name}`);
  lines.push(`- **Review mode**: ${review.mode}`);
  lines.push(`- **Review ID**: ${review.id}`);
  lines.push(`- **Date**: ${new Date().toISOString()}`);
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
      lines.push(`- ${annotationAnchorLabel(a)} [${a.category}]: ${a.content}`);
    }
    lines.push('');
  }

  // AI-authored review notes from `.pr-notes/` (docs/20 §20.8, P5) — fold the
  // generating AI's own rationale/proof into the export for the next session.
  const reviewNoteLines = reviewNotesExportSection(repoRoot, files.map(f => f.file_path));
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
  lines.push('');

  const content = lines.join('\n');

  // Always write the per-ID archive
  const archivePath = join(exportDir, `review-${review.id}.md`);
  writeFileSync(archivePath, content, 'utf-8');

  // Only write latest-review.md for the current review
  if (isCurrent) {
    const latestPath = join(exportDir, 'latest-review.md');
    writeFileSync(latestPath, content, 'utf-8');
    return latestPath;
  }

  return archivePath;
}
