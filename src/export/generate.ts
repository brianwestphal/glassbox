import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { getReview, getReviewFiles, getAnnotationsForReview } from '../db/queries.js';

export function deleteReviewExport(reviewId: string, repoRoot: string): void {
  const exportDir = join(repoRoot, '.glassbox');
  const archivePath = join(exportDir, `review-${reviewId}.md`);
  if (existsSync(archivePath)) unlinkSync(archivePath);
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
    if (!byFile[a.file_path]) byFile[a.file_path] = [];
    byFile[a.file_path].push(a);
  }

  const lines: string[] = [];

  lines.push('# Code Review');
  lines.push('');
  lines.push(`- **Repository**: ${review.repo_name}`);
  lines.push(`- **Review mode**: ${review.mode}${review.mode_args ? ` (${review.mode_args})` : ''}`);
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
      lines.push(`- **${item.file_path}:${item.line_number}** - ${item.content}`);
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
      lines.push(`- **Line ${a.line_number}** [${a.category}]: ${a.content}`);
    }
    lines.push('');
  }

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
