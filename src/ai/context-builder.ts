import type { ReviewFile } from '../db/queries.js';
import type { DiffHunk, FileDiff } from '../git/diff.js';

export interface FileContext {
  fileId: string;
  filePath: string;
  status: string;
  linesAdded: number;
  linesRemoved: number;
  diffText: string;
}

function summarizeHunk(hunk: DiffHunk, maxLines: number): string {
  const lines: string[] = [];
  lines.push(`@@ -${String(hunk.oldStart)},${String(hunk.oldCount)} +${String(hunk.newStart)},${String(hunk.newCount)} @@`);

  const hunkLines = hunk.lines;
  if (hunkLines.length <= maxLines) {
    for (const line of hunkLines) {
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      lines.push(prefix + line.content);
    }
  } else {
    // Show first and last portions
    const half = Math.floor(maxLines / 2);
    for (let i = 0; i < half; i++) {
      const line = hunkLines[i];
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      lines.push(prefix + line.content);
    }
    lines.push(`... (${String(hunkLines.length - maxLines)} lines omitted) ...`);
    for (let i = hunkLines.length - half; i < hunkLines.length; i++) {
      const line = hunkLines[i];
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      lines.push(prefix + line.content);
    }
  }

  return lines.join('\n');
}

function buildDiffText(diff: FileDiff, charBudget: number): string {
  if (diff.isBinary) return '[Binary file]';
  if (diff.hunks.length === 0) return '[No changes]';

  // First try full diff
  const fullLines: string[] = [];
  for (const hunk of diff.hunks) {
    fullLines.push(`@@ -${String(hunk.oldStart)},${String(hunk.oldCount)} +${String(hunk.newStart)},${String(hunk.newCount)} @@`);
    for (const line of hunk.lines) {
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      fullLines.push(prefix + line.content);
    }
  }
  const fullText = fullLines.join('\n');
  if (fullText.length <= charBudget) return fullText;

  // Summarize hunks with decreasing detail
  const maxLinesPerHunk = Math.max(10, Math.floor(charBudget / (diff.hunks.length * 80)));
  return diff.hunks.map(h => summarizeHunk(h, maxLinesPerHunk)).join('\n\n');
}

export function buildFileContexts(files: ReviewFile[], charBudget: number): FileContext[] {
  const contexts: FileContext[] = [];
  const perFileBudget = Math.floor(charBudget / Math.max(files.length, 1));

  for (const file of files) {
    const diff: FileDiff = JSON.parse(file.diff_data !== null && file.diff_data !== '' ? file.diff_data : '{}') as FileDiff;

    let added = 0;
    let removed = 0;
    const hunks = diff.hunks as DiffHunk[] | undefined;
    for (const hunk of hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.type === 'add') added++;
        if (line.type === 'remove') removed++;
      }
    }

    contexts.push({
      fileId: file.id,
      filePath: file.file_path,
      status: (diff.status as string | undefined) ?? file.status,
      linesAdded: added,
      linesRemoved: removed,
      diffText: buildDiffText(diff, perFileBudget),
    });
  }

  return contexts;
}

export function formatContextsForPrompt(contexts: FileContext[]): string {
  const sections = contexts.map(ctx => {
    return [
      `=== ${ctx.filePath} (${ctx.status}, +${String(ctx.linesAdded)} -${String(ctx.linesRemoved)}) ===`,
      ctx.diffText,
    ].join('\n');
  });

  return sections.join('\n\n');
}

export function formatAdditionalContext(files: Array<{ path: string; content: string }>): string {
  return files.map(f => {
    return `=== Full content: ${f.path} ===\n${f.content}`;
  }).join('\n\n');
}
