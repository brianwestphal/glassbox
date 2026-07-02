import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { z } from 'zod';

import { debugLog } from '../debug.js';
import { parseDiff } from './parseDiff.js';
import { getRepoRoot } from './repo.js';
import { git } from './spawn.js';
import type { DiffLine, FileDiff, ReviewMode } from './types.js';
import { GroundTruthEntrySchema } from './types.js';

// Re-exported so existing importers of `parseDiff` from `./diff.js` keep working.
export { parseDiff } from './parseDiff.js';

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

/**
 * Run git for a diff-collection path, degrading to an empty string if it fails
 * rather than throwing — but logging the failure under `--debug` first. Several
 * diff paths intentionally treat a git error as "no diff"; without this log a
 * genuine failure (bad ref, invalid range, scrubbed-env regression) is
 * indistinguishable from a legitimately empty diff and surfaces only as the
 * misleading "No changes found for the specified mode".
 */
function gitOrEmpty(args: string[], cwd: string): string {
  try {
    return git(args, cwd);
  } catch (err) {
    debugLog(`git ${args.join(' ')} failed (treating as empty diff): ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
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
    case 'ground-truth':
      // Ground-truth never runs `git diff` — its files come from the manifest
      // (see getFileDiffs). Unreachable; present only for switch exhaustiveness.
      throw new Error('getDiffArgs: ground-truth mode does not use git diff');
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
  const rawDiff = gitOrEmpty(['diff', '--no-index', '-U3', toGitArg(mode.pathA), toGitArg(mode.pathB)], cwd);
  return normalizeDiffPaths(parseDiff(rawDiff), rootA, rootB);
}

/**
 * Produce a {@link FileDiff} from two raw file contents — no git refs and no
 * caller-managed on-disk paths. Used by the accumulating `git difftool` append
 * endpoint (doc 19, FR-19.7): the wrapper reads `$LOCAL` / `$REMOTE` into memory
 * before git deletes the temp files, then hands the bytes here.
 *
 * Reuses the same `git diff --no-index` engine (and git's own binary detection)
 * as direct comparison (doc 18) by writing the two sides into a throwaway
 * `<tmp>/a/<path>` + `<tmp>/b/<path>` pair and stripping those roots back off, so
 * the entry is labeled with `displayPath`. The temp tree is removed before
 * returning — nothing is left on disk.
 */
export function diffRawContent(displayPath: string, oldContent: Buffer, newContent: Buffer): FileDiff {
  // Normalize to a forward-slash relative path and neutralize absolute /
  // parent-escaping segments so we only ever write inside the temp tree
  // (doc 14, FR-14.3 — never trust an externally supplied path).
  const rel = displayPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/(^|\/)\.\.(?=\/|$)/g, '$1_');
  const safeRel = rel === '' ? 'file' : rel;

  const work = mkdtempSync(join(tmpdir(), 'glassbox-difftool-append-'));
  const rootA = join(work, 'a');
  const rootB = join(work, 'b');
  const oldAbs = join(rootA, safeRel);
  const newAbs = join(rootB, safeRel);
  try {
    mkdirSync(dirname(oldAbs), { recursive: true });
    mkdirSync(dirname(newAbs), { recursive: true });
    writeFileSync(oldAbs, oldContent);
    writeFileSync(newAbs, newContent);

    const rawDiff = gitOrEmpty(['diff', '--no-index', '-U3', toGitArg(oldAbs), toGitArg(newAbs)], work);
    const diffs = normalizeDiffPaths(parseDiff(rawDiff), rootA, rootB);
    if (diffs.length === 0) {
      // git emits nothing for identical content; still surface the file so it
      // appears in the accumulating review (as an unchanged entry).
      return { filePath: safeRel, oldPath: null, status: 'modified', hunks: [], isBinary: false };
    }
    const diff = diffs[0];
    // Both sides are always written, so `git diff --no-index` reports every file
    // as modified/renamed. Recover the add/delete status from content emptiness
    // (git difftool passes an empty temp file for the absent side).
    let status = diff.status;
    if (oldContent.length === 0 && newContent.length > 0) status = 'added';
    else if (newContent.length === 0 && oldContent.length > 0) status = 'deleted';
    return { ...diff, filePath: safeRel, oldPath: null, status };
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

export function getFileDiffs(mode: ReviewMode, cwd: string): FileDiff[] {
  // Direct comparison runs `git diff --no-index` on two arbitrary paths and
  // never touches a repository, so resolve it before the repo-root lookup.
  if (mode.type === 'diff') {
    return getDirectComparisonFiles(mode, cwd);
  }

  // Ground-truth (doc 26): one synthetic binary image entry per manifest
  // comparison. Bytes are served from the resolved paths by the image route;
  // here we only need each entry to render as an image pair (isBinary + an
  // image-extensioned key), so no git is touched.
  if (mode.type === 'ground-truth') {
    return mode.comparisons.map(entry => ({
      filePath: entry.key,
      // The old (A) side is the expected image. Carrying its path lets the image
      // route pick the right content-type when the two sides differ in format
      // (e.g. expected .png vs actual .jpg); byte resolution looks up by key.
      oldPath: entry.expectedPath,
      status: 'modified' as const,
      hunks: [],
      isBinary: true,
    }));
  }

  const repoRoot = getRepoRoot(cwd);

  if (mode.type === 'all') {
    return getAllFiles(repoRoot);
  }

  const diffArgs = getDiffArgs(mode);
  const rawDiff = gitOrEmpty([...diffArgs, '-U3'], repoRoot);

  const diffs = parseDiff(rawDiff);

  // Backfill untracked (brand-new) files as added-file diffs — `git diff HEAD`
  // never reports a file git has not tracked, so without this an untracked file
  // silently shows nothing. `uncommitted` lists every untracked file; `files`
  // scopes the backfill to the requested pathspecs so reviewing a single
  // not-yet-added new file by path still surfaces it.
  if (mode.type === 'uncommitted' || mode.type === 'files') {
    const lsArgs = ['ls-files', '--others', '--exclude-standard'];
    if (mode.type === 'files') lsArgs.push('--', ...mode.patterns);
    const untracked = git(lsArgs, repoRoot).trim();
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
  // Ground-truth entries are images with no text hunks, so context expansion is
  // never requested; reading the bytes as text would be meaningless.
  if (mode.type === 'ground-truth') return '';
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
  if (modeStr.startsWith('ground-truth:')) {
    // JSON-encoded { manifestPath, comparisons } — validated, not asserted,
    // because it round-trips through the DB (doc 26).
    try {
      const parsed = z
        .object({ manifestPath: z.string(), comparisons: z.array(GroundTruthEntrySchema) })
        .safeParse(JSON.parse(modeStr.slice('ground-truth:'.length)));
      if (parsed.success) return { type: 'ground-truth', ...parsed.data };
    } catch { /* fall through to default */ }
  }
  return { type: 'uncommitted' };
}

/** Regenerate a diff for a single file with optional flags (e.g. -w for ignore whitespace). */
export function getSingleFileDiff(mode: ReviewMode, filePath: string, repoRoot: string, extraFlags: string = ''): FileDiff | null {
  if (mode.type === 'all') {
    return createNewFileDiff(filePath, repoRoot);
  }
  // Ground-truth files are binary images with no text hunks, so there is
  // nothing to re-collapse for a whitespace toggle — keep the stored diff.
  if (mode.type === 'ground-truth') return null;
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
    const rawDiff = gitOrEmpty(args, repoRoot);
    const diffs = normalizeDiffPaths(parseDiff(rawDiff), rootA, rootB);
    return diffs[0] ?? null;
  }
  const diffArgs = getDiffArgs(mode);
  const args = [...diffArgs, '-U3'];
  if (extraFlags) args.push(...extraFlags.split(' ').filter(Boolean));
  args.push('--', filePath);
  const rawDiff = gitOrEmpty(args, repoRoot);
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
    case 'ground-truth':
      return `ground-truth:${JSON.stringify({ manifestPath: mode.manifestPath, comparisons: mode.comparisons })}`;
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
    case 'ground-truth': return basename(mode.manifestPath);
    case 'uncommitted':
    case 'staged':
    case 'unstaged':
    case 'all':
      return undefined;
  }
}
