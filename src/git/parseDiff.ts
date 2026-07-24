/**
 * Pure text parser for unified `git diff` output. Splits a raw multi-file diff
 * into {@link FileDiff} records (path, status, binary flag) and parses each
 * file's `@@` hunks into typed add/remove/context lines with old/new line
 * numbers. No git, fs, or network — feed it the raw string from any diff source
 * (tracked diffs, `--no-index`, a temp-tree diff).
 *
 * Companion to `parseDiffData.ts`, which decodes the already-serialized
 * `review_files.diff_data` JSON column; this one parses git's textual output.
 */
import { isLfsPointer } from '../utils/lfs.js';
import type { DiffHunk, DiffLine, FileDiff } from './types.js';

export function parseDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const headerEnd = chunk.indexOf('@@');
    const header = headerEnd === -1 ? chunk : chunk.slice(0, headerEnd);

    if (headerEnd === -1 && !header.includes('Binary')) {
      const pathMatch = chunk.match(/^a\/(.+?) b\/(.+)/m);
      if (pathMatch) {
        // This branch is only reached for non-binary chunks with no `@@` hunk
        // (empty new files, pure mode changes, content-less renames), so the
        // file is never binary here — binary files carry the "Binary files …
        // differ" header and are handled below.
        files.push({
          filePath: pathMatch[2],
          oldPath: pathMatch[1] !== pathMatch[2] ? pathMatch[1] : null,
          status: header.includes('new file') ? 'added' : header.includes('deleted file') ? 'deleted' : 'modified',
          hunks: [],
          isBinary: false,
        });
      }
      continue;
    }

    const pathMatch = chunk.match(/^a\/(.+?) b\/(.+)/m);
    if (!pathMatch) continue;

    const filePath = pathMatch[2];
    const oldPath = pathMatch[1] !== pathMatch[2] ? pathMatch[1] : null;

    let status: FileDiff['status'] = 'modified';
    if (header.includes('new file mode')) status = 'added';
    else if (header.includes('deleted file mode')) status = 'deleted';
    else if (oldPath !== null) status = 'renamed';

    const isBinary = header.includes('Binary file');
    if (isBinary) {
      files.push({ filePath, oldPath, status, hunks: [], isBinary: true });
      continue;
    }

    const hunks = parseHunks(chunk.slice(headerEnd));
    // An LFS-tracked file diffs as a three-line *text* pointer, with no
    // "Binary files … differ" header, so without this an LFS-tracked PNG would
    // render as a text diff of `oid sha256:…` instead of an image comparison.
    // Drop the hunks as well as flagging it: the pointer text is never
    // reviewable content, and leaving it on a binary diff would carry it into
    // everything downstream that reads hunks (the stored `diff_data`, the AI
    // analysis prompt, the export).
    if (hunksAreLfsPointer(hunks)) {
      files.push({ filePath, oldPath, status, hunks: [], isBinary: true });
      continue;
    }
    files.push({ filePath, oldPath, status, hunks, isBinary: false });
  }

  return files;
}

/**
 * Whether these hunks describe a Git LFS pointer file. Reconstructs each side's
 * content from the hunk lines and tests it: a pointer is only three lines, so a
 * genuine text file has to *be* a pointer to match. Either side counts — adding,
 * deleting, or modifying an LFS-tracked file all mean the pointer text is the
 * only thing git will show us.
 */
function hunksAreLfsPointer(hunks: DiffHunk[]): boolean {
  if (hunks.length !== 1) return false;
  const lines = hunks[0].lines;
  const side = (types: DiffLine['type'][]): string =>
    lines.filter(l => types.includes(l.type)).map(l => l.content).join('\n') + '\n';
  return isLfsPointer(side(['context', 'add'])) || isLfsPointer(side(['context', 'remove']));
}

function parseHunks(raw: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const hunkRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/gm;
  let match: RegExpExecArray | null;
  const hunkStarts: { index: number; oldStart: number; oldCount: number; newStart: number; newCount: number }[] = [];

  while ((match = hunkRegex.exec(raw)) !== null) {
    const groups = match as unknown as (string | undefined)[];
    hunkStarts.push({
      index: match.index + match[0].length,
      oldStart: parseInt(match[1], 10),
      oldCount: groups[2] !== undefined ? parseInt(groups[2], 10) : 1,
      newStart: parseInt(match[3], 10),
      newCount: groups[4] !== undefined ? parseInt(groups[4], 10) : 1,
    });
  }

  for (let i = 0; i < hunkStarts.length; i++) {
    const start = hunkStarts[i];
    const end = i + 1 < hunkStarts.length ? raw.lastIndexOf('\n@@', hunkStarts[i + 1].index) : raw.length;
    const body = raw.slice(start.index, end);
    const lines: DiffLine[] = [];
    let oldNum = start.oldStart;
    let newNum = start.newStart;

    for (const line of body.split('\n')) {
      if (line === '') continue;
      if (line.startsWith('+')) {
        lines.push({ type: 'add', oldNum: null, newNum, content: line.slice(1) });
        newNum++;
      } else if (line.startsWith('-')) {
        lines.push({ type: 'remove', oldNum, newNum: null, content: line.slice(1) });
        oldNum++;
      } else if (line.startsWith(' ') || line.startsWith('\\')) {
        if (line.startsWith('\\')) continue;
        lines.push({ type: 'context', oldNum, newNum, content: line.slice(1) });
        oldNum++;
        newNum++;
      }
    }

    hunks.push({
      oldStart: start.oldStart,
      oldCount: start.oldCount,
      newStart: start.newStart,
      newCount: start.newCount,
      lines,
    });
  }

  return hunks;
}
