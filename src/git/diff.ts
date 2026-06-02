import { spawnSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

import { getRepoRoot } from './repo.js';
import type { DiffHunk, DiffLine, FileDiff, ReviewMode } from './types.js';

// Re-export types and repo functions so existing importers don't break
export { parseDiffData } from './parseDiffData.js';
export { getHeadCommit,getRepoName, getRepoRoot, isGitRepo } from './repo.js';
export type { DiffHunk, DiffLine, FileDiff, ReviewMode } from './types.js';

/**
 * Normalize a path to forward slashes for `git diff --no-index` on Windows.
 *
 * git-for-windows, handed a backslash path, emits a *quoted, backslash-escaped*
 * diff header — `diff --git "a/D:\\dir/f.txt" "b/..."` — which `parseDiff`
 * doesn't recognize (it expects the plain `a/path b/path` form), so every file
 * silently vanished and `--diff` reported "no changes" (GB-856). Passing
 * forward slashes makes git emit the standard unquoted header. No-op off
 * Windows, so unix filenames that legitimately contain backslashes are
 * untouched.
 */
const toGitArg = (p: string): string => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  if (result.status === 0) return result.stdout;
  if (result.stdout !== '') return result.stdout;
  const err: Error & { stdout?: string; stderr?: string; status?: number | null } = new Error(result.stderr);
  err.stdout = result.stdout;
  err.stderr = result.stderr;
  err.status = result.status;
  throw err;
}

export function getDiffArgs(mode: ReviewMode): string[] {
  switch (mode.type) {
    case 'uncommitted':
      return ['diff', 'HEAD'];
    case 'staged':
      return ['diff', '--cached'];
    case 'unstaged':
      return ['diff'];
    case 'commit':
      return ['diff', `${mode.sha}~1`, mode.sha];
    case 'range':
      return ['diff', mode.from, mode.to];
    case 'branch':
      return ['diff', `${mode.name}...HEAD`];
    case 'files':
      return ['diff', 'HEAD', '--', ...mode.patterns];
    case 'all':
      return ['diff', '--no-index', '/dev/null', '.'];
    case 'diff':
      return ['diff', '--no-index', mode.pathA, mode.pathB];
  }
}

/**
 * Direct comparison (doc 18): the display "root" each side's paths are relative
 * to. For a folder the root is the folder itself; for a single file it's the
 * file's parent directory, so the file shows under its basename.
 */
export function directComparisonRoots(mode: { pathA: string; pathB: string }): { rootA: string; rootB: string } {
  const rootOf = (p: string): string => {
    try {
      return statSync(p).isDirectory() ? p : dirname(p);
    } catch {
      return dirname(p);
    }
  };
  return { rootA: rootOf(mode.pathA), rootB: rootOf(mode.pathB) };
}

/**
 * Strip a root prefix off a path captured from a `git diff --no-index` header.
 * git removes the leading slash and prepends `a/` / `b/`; `parseDiff` returns
 * the part after that prefix, so the captured path looks like
 * `Users/foo/dirB/sub/x.ts`. Removing the (slash-stripped) root yields the
 * display-relative path `sub/x.ts`.
 */
function stripRoot(headerPath: string, root: string): string {
  // The header path arrives forward-slashed (git emits `a/<root>/<rel>`); on
  // Windows the root is backslashed, so normalize before comparing (GB-856).
  const norm = root.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = norm.endsWith('/') ? norm : `${norm}/`;
  return headerPath.startsWith(prefix) ? headerPath.slice(prefix.length) : headerPath;
}

/**
 * Rewrite the root-prefixed paths `git diff --no-index` emits into paths
 * relative to the compared roots. The new side (`filePath`) is normally
 * b-rooted; for a pure deletion git repeats the a-side path on the b-side, so
 * fall back to the A root. An old path equal to the new path is not a rename,
 * so it is dropped.
 */
function normalizeDiffPaths(diffs: FileDiff[], rootA: string, rootB: string): FileDiff[] {
  return diffs.map((d) => {
    let filePath = stripRoot(d.filePath, rootB);
    if (filePath === d.filePath) filePath = stripRoot(d.filePath, rootA);
    const oldRel = d.oldPath !== null ? stripRoot(d.oldPath, rootA) : null;
    const oldPath = oldRel !== null && oldRel !== filePath ? oldRel : null;
    // `git diff --no-index` always reports differing header paths (the two
    // roots differ), so a same-relative-path file arrives as 'renamed'. Once
    // the roots are stripped and the relative paths match, it's a plain
    // modification, not a rename.
    const status = d.status === 'renamed' && oldPath === null ? 'modified' : d.status;
    return { ...d, filePath, oldPath, status };
  });
}

function getDirectComparisonFiles(mode: { pathA: string; pathB: string }, cwd: string): FileDiff[] {
  const { rootA, rootB } = directComparisonRoots(mode);
  let rawDiff: string;
  try {
    rawDiff = git(['diff', '--no-index', '-U3', toGitArg(mode.pathA), toGitArg(mode.pathB)], cwd);
  } catch {
    rawDiff = '';
  }
  return normalizeDiffPaths(parseDiff(rawDiff), rootA, rootB);
}

export function getFileDiffs(mode: ReviewMode, cwd: string): FileDiff[] {
  // Direct comparison runs `git diff --no-index` on two arbitrary paths and
  // never touches a repository, so resolve it before the repo-root lookup.
  if (mode.type === 'diff') {
    return getDirectComparisonFiles(mode, cwd);
  }

  const repoRoot = getRepoRoot(cwd);

  if (mode.type === 'all') {
    return getAllFiles(repoRoot);
  }

  const diffArgs = getDiffArgs(mode);
  let rawDiff: string;
  try {
    rawDiff = git([...diffArgs, '-U3'], repoRoot);
  } catch {
    rawDiff = '';
  }

  const diffs = parseDiff(rawDiff);

  if (mode.type === 'uncommitted') {
    const untracked = git(['ls-files', '--others', '--exclude-standard'], repoRoot).trim();
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
  const files = git(['ls-files'], repoRoot).trim().split('\n').filter(Boolean);
  return files.map(file => createNewFileDiff(file, repoRoot));
}

function createNewFileDiff(filePath: string, repoRoot: string): FileDiff {
  let content: string;
  try {
    const buf = readFileSync(resolve(repoRoot, filePath));
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

export function getFileContent(filePath: string, ref: string, cwd: string): string {
  const repoRoot = getRepoRoot(cwd);
  try {
    if (ref === 'working') {
      return readFileSync(resolve(repoRoot, filePath), 'utf-8');
    }
    return git(['show', `${ref}:${filePath}`], repoRoot);
  } catch {
    return '';
  }
}

/**
 * Read a review file's content for a given side ('old' | 'new'), aware of
 * direct-comparison mode where the two sides live under two arbitrary roots on
 * disk (no git refs). Used by context expansion (doc 18, FR-18.5). For all
 * git-backed modes it falls back to {@link getFileContent}.
 */
export function getModeFileContent(mode: ReviewMode, filePath: string, side: 'old' | 'new', cwd: string): string {
  if (mode.type === 'diff') {
    const { rootA, rootB } = directComparisonRoots(mode);
    const abs = join(side === 'old' ? rootA : rootB, filePath);
    try {
      return readFileSync(abs, 'utf-8');
    } catch {
      return '';
    }
  }
  return getFileContent(filePath, side === 'old' ? 'HEAD' : 'working', cwd);
}

export function parseModeString(modeStr: string): ReviewMode {
  if (modeStr === 'uncommitted') return { type: 'uncommitted' };
  if (modeStr === 'staged') return { type: 'staged' };
  if (modeStr === 'unstaged') return { type: 'unstaged' };
  if (modeStr === 'all') return { type: 'all' };
  if (modeStr.startsWith('commit:')) return { type: 'commit', sha: modeStr.slice(7) };
  if (modeStr.startsWith('range:')) {
    const parts = modeStr.slice(6).split('..');
    return { type: 'range', from: parts[0], to: parts[1] || 'HEAD' };
  }
  if (modeStr.startsWith('branch:')) return { type: 'branch', name: modeStr.slice(7) };
  if (modeStr.startsWith('files:')) return { type: 'files', patterns: modeStr.slice(6).split(',') };
  if (modeStr.startsWith('diff:')) {
    // JSON-encoded `[pathA, pathB]` so arbitrary path characters round-trip.
    try {
      const parsed: unknown = JSON.parse(modeStr.slice(5));
      if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
        return { type: 'diff', pathA: parsed[0], pathB: parsed[1] };
      }
    } catch { /* fall through to default */ }
  }
  return { type: 'uncommitted' };
}

/** Regenerate a diff for a single file with optional flags (e.g. -w for ignore whitespace). */
export function getSingleFileDiff(mode: ReviewMode, filePath: string, repoRoot: string, extraFlags: string = ''): FileDiff | null {
  if (mode.type === 'all') {
    return createNewFileDiff(filePath, repoRoot);
  }
  if (mode.type === 'diff') {
    // Re-diff just this file's two sides under their roots. `filePath` is the
    // new-side relative path; for the common modified case the old side shares
    // it. If either side is missing (added/deleted), there's nothing to
    // re-collapse for whitespace, so keep the stored diff.
    const { rootA, rootB } = directComparisonRoots(mode);
    const oldAbs = join(rootA, filePath);
    const newAbs = join(rootB, filePath);
    if (!existsSync(oldAbs) || !existsSync(newAbs)) return null;
    const args = ['diff', '--no-index', '-U3'];
    if (extraFlags) args.push(...extraFlags.split(' ').filter(Boolean));
    args.push(toGitArg(oldAbs), toGitArg(newAbs));
    let rawDiff: string;
    try {
      rawDiff = git(args, repoRoot);
    } catch {
      rawDiff = '';
    }
    const diffs = normalizeDiffPaths(parseDiff(rawDiff), rootA, rootB);
    return diffs[0] ?? null;
  }
  const diffArgs = getDiffArgs(mode);
  const args = [...diffArgs, '-U3'];
  if (extraFlags) args.push(...extraFlags.split(' ').filter(Boolean));
  args.push('--', filePath);
  let rawDiff: string;
  try {
    rawDiff = git(args, repoRoot);
  } catch {
    rawDiff = '';
  }
  const diffs = parseDiff(rawDiff);
  return diffs[0] ?? null;
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
    case 'diff': return `diff:${JSON.stringify([mode.pathA, mode.pathB])}`;
  }
}

export function getModeArgs(mode: ReviewMode): string | undefined {
  switch (mode.type) {
    case 'commit': return mode.sha;
    case 'range': return `${mode.from}..${mode.to}`;
    case 'branch': return mode.name;
    case 'files': return mode.patterns.join(',');
    // A short, human-readable label for the sidebar/history. Full path
    // disambiguation lives in the mode string, so basenames are fine here.
    case 'diff': return `${basename(mode.pathA)} ↔ ${basename(mode.pathB)}`;
    case 'uncommitted':
    case 'staged':
    case 'unstaged':
    case 'all':
      return undefined;
  }
}
