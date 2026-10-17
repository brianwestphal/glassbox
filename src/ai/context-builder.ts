import type { ReviewFile } from '../db/queries.js';
import type { DiffHunk, DiffLine, FileDiff } from '../git/diff.js';
import { emptyFileDiff, parseDiffData } from '../git/parseDiffData.js';

/** The leading `+` / `-` / ` ` character for a diff line in plain-text output. */
function linePrefix(type: DiffLine['type']): string {
  return type === 'add' ? '+' : type === 'remove' ? '-' : ' ';
}

/** Keep source coordinates explicit, including after omitted lines and deletions. */
function numberedLine(line: DiffLine): string {
  return `[old:${line.oldNum ?? '-'} new:${line.newNum ?? '-'}] ${linePrefix(line.type)}${line.content}`;
}

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
      lines.push(numberedLine(line));
    }
  } else {
    // Show first and last portions
    const half = Math.floor(maxLines / 2);
    for (let i = 0; i < half; i++) {
      const line = hunkLines[i];
      lines.push(numberedLine(line));
    }
    lines.push(`... (${String(hunkLines.length - half * 2)} lines omitted) ...`);
    for (let i = hunkLines.length - half; i < hunkLines.length; i++) {
      const line = hunkLines[i];
      lines.push(numberedLine(line));
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
      fullLines.push(numberedLine(line));
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
    const diff: FileDiff = parseDiffData(file.diff_data) ?? emptyFileDiff(file.file_path);

    let added = 0;
    let removed = 0;
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') added++;
        if (line.type === 'remove') removed++;
      }
    }

    contexts.push({
      fileId: file.id,
      filePath: file.file_path,
      status: diff.status,
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

  return 'Coordinates [old:N new:N] are source line numbers, not diff row numbers. Use new:N for NEW-side notes; new:- has no new-side line. Never count omitted lines.\n\n' + sections.join('\n\n');
}

export function formatAdditionalContext(files: Array<{ path: string; content: string }>): string {
  return files.map(f => {
    const numbered = f.content.split('\n').map((line, index) => `[new:${String(index + 1)}] ${line}`).join('\n');
    return `=== Full content: ${f.path} ===\n${numbered}`;
  }).join('\n\n');
}
