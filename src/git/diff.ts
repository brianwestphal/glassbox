import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  oldNum: number | null;
  newNum: number | null;
  content: string;
}

export interface FileDiff {
  filePath: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  isBinary: boolean;
}

function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    if (err.stdout) return err.stdout;
    throw e;
  }
}

export function getRepoRoot(cwd: string): string {
  return git('rev-parse --show-toplevel', cwd).trim();
}

export function getRepoName(cwd: string): string {
  const root = getRepoRoot(cwd);
  return root.split('/').pop() || 'unknown';
}

export function isGitRepo(cwd: string): boolean {
  try {
    git('rev-parse --is-inside-work-tree', cwd);
    return true;
  } catch {
    return false;
  }
}

export type ReviewMode =
  | { type: 'uncommitted' }
  | { type: 'staged' }
  | { type: 'unstaged' }
  | { type: 'commit'; sha: string }
  | { type: 'range'; from: string; to: string }
  | { type: 'branch'; name: string }
  | { type: 'files'; patterns: string[] }
  | { type: 'all' };

export function getDiffArgs(mode: ReviewMode): string {
  switch (mode.type) {
    case 'uncommitted':
      return 'diff HEAD';
    case 'staged':
      return 'diff --cached';
    case 'unstaged':
      return 'diff';
    case 'commit':
      return `diff ${mode.sha}~1 ${mode.sha}`;
    case 'range':
      return `diff ${mode.from} ${mode.to}`;
    case 'branch': {
      return `diff ${mode.name}...HEAD`;
    }
    case 'files':
      return `diff HEAD -- ${mode.patterns.join(' ')}`;
    case 'all':
      return 'diff --no-index /dev/null .';
  }
}

export function getFileDiffs(mode: ReviewMode, cwd: string): FileDiff[] {
  const repoRoot = getRepoRoot(cwd);

  if (mode.type === 'all') {
    return getAllFiles(repoRoot);
  }

  const diffArgs = getDiffArgs(mode);
  let rawDiff: string;
  try {
    rawDiff = git(`${diffArgs} -U3`, repoRoot);
  } catch {
    rawDiff = '';
  }

  // For uncommitted mode, also include untracked files
  const diffs = parseDiff(rawDiff);

  if (mode.type === 'uncommitted') {
    const untracked = git('ls-files --others --exclude-standard', repoRoot).trim();
    if (untracked) {
      for (const file of untracked.split('\n').filter(Boolean)) {
        if (!diffs.some(d => d.filePath === file)) {
          diffs.push(createNewFileDiff(file, repoRoot));
        }
      }
    }
  }

  return diffs;
}

function getAllFiles(repoRoot: string): FileDiff[] {
  const files = git('ls-files', repoRoot).trim().split('\n').filter(Boolean);
  return files.map(file => createNewFileDiff(file, repoRoot));
}

function createNewFileDiff(filePath: string, repoRoot: string): FileDiff {
  let content: string;
  try {
    const buf = readFileSync(resolve(repoRoot, filePath));
    // Check first 8KB of raw bytes for null bytes
    const checkLen = Math.min(buf.length, 8192);
    for (let i = 0; i < checkLen; i++) {
      if (buf[i] === 0) {
        return { filePath, oldPath: null, status: 'added', hunks: [], isBinary: true };
      }
    }
    content = buf.toString('utf-8');
  } catch {
    content = '';
  }

  const lines = content.split('\n');
  const diffLines: DiffLine[] = lines.map((line, i) => ({
    type: 'add' as const,
    oldNum: null,
    newNum: i + 1,
    content: line,
  }));

  return {
    filePath,
    oldPath: null,
    status: 'added',
    hunks: diffLines.length ? [{
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: lines.length,
      lines: diffLines,
    }] : [],
    isBinary: false,
  };
}

export function parseDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const headerEnd = chunk.indexOf('@@');
    // Only check the header portion for binary indicators (not diff content which may contain "Binary file" as text)
    const header = headerEnd === -1 ? chunk : chunk.slice(0, headerEnd);

    if (headerEnd === -1 && !header.includes('Binary')) {
      // Possibly a file with no changes or binary
      const pathMatch = chunk.match(/^a\/(.+?) b\/(.+)/m);
      if (pathMatch) {
        const isBinary = header.includes('Binary');
        files.push({
          filePath: pathMatch[2],
          oldPath: pathMatch[1] !== pathMatch[2] ? pathMatch[1] : null,
          status: header.includes('new file') ? 'added' : header.includes('deleted file') ? 'deleted' : 'modified',
          hunks: [],
          isBinary,
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
    else if (oldPath) status = 'renamed';

    const isBinary = header.includes('Binary file');
    if (isBinary) {
      files.push({ filePath, oldPath, status, hunks: [], isBinary: true });
      continue;
    }

    const hunks = parseHunks(chunk.slice(headerEnd));
    files.push({ filePath, oldPath, status, hunks, isBinary: false });
  }

  return files;
}

function parseHunks(raw: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const hunkRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/gm;
  let match: RegExpExecArray | null;
  const hunkStarts: { index: number; oldStart: number; oldCount: number; newStart: number; newCount: number }[] = [];

  while ((match = hunkRegex.exec(raw)) !== null) {
    hunkStarts.push({
      index: match.index + match[0].length,
      oldStart: parseInt(match[1], 10),
      oldCount: match[2] != null ? parseInt(match[2], 10) : 1,
      newStart: parseInt(match[3], 10),
      newCount: match[4] != null ? parseInt(match[4], 10) : 1,
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
        if (line.startsWith('\\')) continue; // "No newline at end of file"
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

export function getFileContent(filePath: string, ref: string, cwd: string): string {
  const repoRoot = getRepoRoot(cwd);
  try {
    if (ref === 'working') {
      return execSync(`cat "${resolve(repoRoot, filePath)}"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    }
    return git(`show ${ref}:${filePath}`, repoRoot);
  } catch {
    return '';
  }
}

export function getHeadCommit(cwd: string): string {
  return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
}

export function getModeString(mode: ReviewMode): string {
  switch (mode.type) {
    case 'uncommitted': return 'uncommitted';
    case 'staged': return 'staged';
    case 'unstaged': return 'unstaged';
    case 'commit': return `commit:${mode.sha}`;
    case 'range': return `range:${mode.from}..${mode.to}`;
    case 'branch': return `branch:${mode.name}`;
    case 'files': return `files:${mode.patterns.join(',')}`;
    case 'all': return 'all';
  }
}

export function getModeArgs(mode: ReviewMode): string | undefined {
  switch (mode.type) {
    case 'commit': return mode.sha;
    case 'range': return `${mode.from}..${mode.to}`;
    case 'branch': return mode.name;
    case 'files': return mode.patterns.join(',');
    default: return undefined;
  }
}
