/**
 * Integration tests for src/git/diff.ts using real temporary git repositories.
 *
 * These tests exercise the functions that interact with the filesystem and git
 * process, which cannot be meaningfully tested with fixtures alone:
 *   - getFileDiffs()
 *   - getAllFiles() (via getFileDiffs with mode 'all')
 *   - createNewFileDiff() (via getFileDiffs and getAllFiles)
 *   - getFileContent()
 *   - getHeadCommit()
 *   - parseDiff() mode-only change branch (no @@ hunks, no Binary header)
 */

import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getFileDiffs,
  getFileContent,
  getHeadCommit,
  parseDiff,
} from '../../../src/git/diff.js';

// ---------------------------------------------------------------------------
// Helper: create a temporary git repository
// ---------------------------------------------------------------------------

interface TempRepo {
  /** Absolute path to the repository root */
  path: string;
  /** Remove the directory when tests are done */
  cleanup: () => void;
}

function createTempRepo(): TempRepo {
  const repoPath = mkdtempSync(join(tmpdir(), 'glassbox-git-test-'));

  const git = (args: string) =>
    execSync(`git ${args}`, { cwd: repoPath, encoding: 'utf-8', stdio: 'pipe' });

  git('init');
  git('config user.email "test@example.com"');
  git('config user.name "Test User"');
  // Ensure a stable default branch name regardless of the host git config
  git('checkout -b main');

  return {
    path: repoPath,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
  };
}

/** Commit all staged changes (or all tracked changes via -a). */
function gitCommit(repoPath: string, message: string, addAll = false): string {
  if (addAll) {
    execSync('git add -A', { cwd: repoPath, stdio: 'pipe' });
  }
  execSync(`git commit -m "${message}"`, { cwd: repoPath, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
}

// ---------------------------------------------------------------------------
// Shared repo: created once, used by multiple suites
// ---------------------------------------------------------------------------

let repo: TempRepo;

/**
 * Initial state after beforeAll:
 *
 *   hello.txt  — committed, contains "hello\n"
 */
beforeAll(() => {
  repo = createTempRepo();

  writeFileSync(join(repo.path, 'hello.txt'), 'hello\n');
  gitCommit(repo.path, 'initial commit', true);
});

afterAll(() => {
  repo.cleanup();
});

// ---------------------------------------------------------------------------
// getFileDiffs — uncommitted mode
// ---------------------------------------------------------------------------

describe('getFileDiffs — uncommitted mode', () => {
  let cleanup: (() => void) | undefined;

  afterAll(() => cleanup?.());

  it('returns a diff for a modified tracked file', () => {
    const r = createTempRepo();
    cleanup = r.cleanup;

    writeFileSync(join(r.path, 'file.txt'), 'line one\n');
    gitCommit(r.path, 'initial', true);

    // Modify without staging
    writeFileSync(join(r.path, 'file.txt'), 'line one\nline two\n');

    const diffs = getFileDiffs({ type: 'uncommitted' }, r.path);

    expect(diffs.length).toBeGreaterThanOrEqual(1);
    const diff = diffs.find(d => d.filePath === 'file.txt');
    expect(diff).toBeDefined();
    expect(diff!.status).toBe('modified');
    expect(diff!.isBinary).toBe(false);
    expect(diff!.hunks.length).toBeGreaterThan(0);

    const addedLine = diff!.hunks[0].lines.find(
      l => l.type === 'add' && l.content === 'line two',
    );
    expect(addedLine).toBeDefined();
  });

  it('includes untracked files as added diffs', () => {
    const r = createTempRepo();
    // Override cleanup — only keep the last one alive, or use a local ref.
    // Each sub-test in this describe uses its own repo; the afterAll above
    // will cleanup whichever `cleanup` was last assigned. For correctness,
    // clean up the previous one first.
    cleanup?.();
    cleanup = r.cleanup;

    writeFileSync(join(r.path, 'tracked.txt'), 'tracked\n');
    gitCommit(r.path, 'initial', true);

    // Add an untracked file (not staged, not committed)
    writeFileSync(join(r.path, 'untracked.txt'), 'brand new\n');

    const diffs = getFileDiffs({ type: 'uncommitted' }, r.path);

    const newFileDiff = diffs.find(d => d.filePath === 'untracked.txt');
    expect(newFileDiff).toBeDefined();
    expect(newFileDiff!.status).toBe('added');
    expect(newFileDiff!.isBinary).toBe(false);
    expect(newFileDiff!.hunks).toHaveLength(1);

    const lines = newFileDiff!.hunks[0].lines;
    expect(lines.every(l => l.type === 'add')).toBe(true);
    expect(lines[0].content).toBe('brand new');
  });
});

// ---------------------------------------------------------------------------
// getFileDiffs — staged mode
// ---------------------------------------------------------------------------

describe('getFileDiffs — staged mode', () => {
  it('returns a diff for staged changes', () => {
    const r = createTempRepo();
    try {
      writeFileSync(join(r.path, 'staged.txt'), 'original\n');
      gitCommit(r.path, 'initial', true);

      writeFileSync(join(r.path, 'staged.txt'), 'original\nappended\n');
      execSync('git add staged.txt', { cwd: r.path, stdio: 'pipe' });

      const diffs = getFileDiffs({ type: 'staged' }, r.path);

      expect(diffs.length).toBeGreaterThanOrEqual(1);
      const diff = diffs.find(d => d.filePath === 'staged.txt');
      expect(diff).toBeDefined();
      expect(diff!.status).toBe('modified');

      const added = diff!.hunks[0].lines.find(
        l => l.type === 'add' && l.content === 'appended',
      );
      expect(added).toBeDefined();
    } finally {
      r.cleanup();
    }
  });

  it('returns empty array when nothing is staged', () => {
    const r = createTempRepo();
    try {
      writeFileSync(join(r.path, 'file.txt'), 'content\n');
      gitCommit(r.path, 'initial', true);

      // Modify but do NOT stage
      writeFileSync(join(r.path, 'file.txt'), 'changed\n');

      const diffs = getFileDiffs({ type: 'staged' }, r.path);
      expect(diffs).toHaveLength(0);
    } finally {
      r.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// getFileDiffs — commit mode
// ---------------------------------------------------------------------------

describe('getFileDiffs — commit mode', () => {
  it('returns diffs for a specific commit SHA', () => {
    const r = createTempRepo();
    try {
      writeFileSync(join(r.path, 'base.txt'), 'version one\n');
      gitCommit(r.path, 'v1', true);

      writeFileSync(join(r.path, 'base.txt'), 'version two\n');
      const sha = gitCommit(r.path, 'v2', true);

      const diffs = getFileDiffs({ type: 'commit', sha }, r.path);

      expect(diffs.length).toBeGreaterThanOrEqual(1);
      const diff = diffs.find(d => d.filePath === 'base.txt');
      expect(diff).toBeDefined();
      expect(diff!.status).toBe('modified');

      const removed = diff!.hunks[0].lines.find(
        l => l.type === 'remove' && l.content === 'version one',
      );
      const added = diff!.hunks[0].lines.find(
        l => l.type === 'add' && l.content === 'version two',
      );
      expect(removed).toBeDefined();
      expect(added).toBeDefined();
    } finally {
      r.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// getFileDiffs — all mode (exercises getAllFiles internally)
// ---------------------------------------------------------------------------

describe('getFileDiffs — all mode (getAllFiles)', () => {
  it('returns all tracked files as added diffs', () => {
    const r = createTempRepo();
    try {
      writeFileSync(join(r.path, 'alpha.txt'), 'alpha\n');
      writeFileSync(join(r.path, 'beta.txt'), 'beta\n');
      gitCommit(r.path, 'initial', true);

      const diffs = getFileDiffs({ type: 'all' }, r.path);

      const filePaths = diffs.map(d => d.filePath);
      expect(filePaths).toContain('alpha.txt');
      expect(filePaths).toContain('beta.txt');

      for (const diff of diffs) {
        expect(diff.status).toBe('added');
        // Each file should have exactly one hunk with all add lines
        expect(diff.hunks).toHaveLength(1);
        expect(diff.hunks[0].lines.every(l => l.type === 'add')).toBe(true);
      }
    } finally {
      r.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// createNewFileDiff — binary file detection
// ---------------------------------------------------------------------------

describe('createNewFileDiff — via getFileDiffs (all mode)', () => {
  it('detects a binary file and returns null-content diff', () => {
    const r = createTempRepo();
    try {
      // Write a buffer containing a null byte — the binary detection heuristic
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]);
      const binPath = join(r.path, 'image.bin');
      writeFileSync(binPath, binaryContent);
      gitCommit(r.path, 'add binary', true);

      const diffs = getFileDiffs({ type: 'all' }, r.path);

      const binDiff = diffs.find(d => d.filePath === 'image.bin');
      expect(binDiff).toBeDefined();
      expect(binDiff!.isBinary).toBe(true);
      expect(binDiff!.status).toBe('added');
      expect(binDiff!.hunks).toHaveLength(0);
    } finally {
      r.cleanup();
    }
  });

  it('creates correct diff for a plain text untracked file', () => {
    const r = createTempRepo();
    try {
      // Need at least one commit so the repo is valid
      writeFileSync(join(r.path, 'placeholder.txt'), 'x\n');
      gitCommit(r.path, 'initial', true);

      writeFileSync(join(r.path, 'newfile.ts'), 'const x = 1;\nconst y = 2;\n');

      // Use uncommitted mode — untracked files are picked up via createNewFileDiff
      const diffs = getFileDiffs({ type: 'uncommitted' }, r.path);

      const diff = diffs.find(d => d.filePath === 'newfile.ts');
      expect(diff).toBeDefined();
      expect(diff!.status).toBe('added');
      expect(diff!.isBinary).toBe(false);
      expect(diff!.oldPath).toBeNull();
      expect(diff!.hunks).toHaveLength(1);

      const hunk = diff!.hunks[0];
      expect(hunk.oldStart).toBe(0);
      expect(hunk.oldCount).toBe(0);
      expect(hunk.newStart).toBe(1);

      // All lines must be additions with sequential newNum values
      for (const line of hunk.lines) {
        expect(line.type).toBe('add');
        expect(line.oldNum).toBeNull();
      }
      expect(hunk.lines[0].content).toBe('const x = 1;');
      expect(hunk.lines[0].newNum).toBe(1);
      expect(hunk.lines[1].content).toBe('const y = 2;');
      expect(hunk.lines[1].newNum).toBe(2);
    } finally {
      r.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// getFileContent
// ---------------------------------------------------------------------------

describe('getFileContent', () => {
  it('returns content of a committed file at HEAD', () => {
    const content = getFileContent('hello.txt', 'HEAD', repo.path);
    expect(content).toBe('hello\n');
  });

  it('returns content of a committed file at a specific ref', () => {
    const r = createTempRepo();
    try {
      writeFileSync(join(r.path, 'versioned.txt'), 'v1 content\n');
      const sha = gitCommit(r.path, 'v1', true);

      writeFileSync(join(r.path, 'versioned.txt'), 'v2 content\n');
      gitCommit(r.path, 'v2', true);

      // Read the file as it was at the first commit
      const content = getFileContent('versioned.txt', sha, r.path);
      expect(content).toBe('v1 content\n');
    } finally {
      r.cleanup();
    }
  });

  it('returns empty string for a file that does not exist at the given ref', () => {
    // 'nonexistent.txt' was never committed in the shared repo
    const content = getFileContent('nonexistent.txt', 'HEAD', repo.path);
    expect(content).toBe('');
  });

  it('returns working-copy content when ref is "working"', () => {
    const r = createTempRepo();
    try {
      writeFileSync(join(r.path, 'work.txt'), 'committed\n');
      gitCommit(r.path, 'initial', true);

      // Modify without staging — only the working copy changes
      writeFileSync(join(r.path, 'work.txt'), 'working copy\n');

      const content = getFileContent('work.txt', 'working', r.path);
      expect(content).toBe('working copy\n');
    } finally {
      r.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// getHeadCommit
// ---------------------------------------------------------------------------

describe('getHeadCommit', () => {
  it('returns a 40-character hex SHA', () => {
    const sha = getHeadCommit(repo.path);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('changes after a new commit', () => {
    const r = createTempRepo();
    try {
      writeFileSync(join(r.path, 'file.txt'), 'initial\n');
      gitCommit(r.path, 'first', true);

      const sha1 = getHeadCommit(r.path);

      writeFileSync(join(r.path, 'file.txt'), 'changed\n');
      gitCommit(r.path, 'second', true);

      const sha2 = getHeadCommit(r.path);

      expect(sha1).not.toBe(sha2);
      expect(sha2).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      r.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// parseDiff — mode-only change branch (no @@ hunks, no Binary header)
// ---------------------------------------------------------------------------

describe('parseDiff — mode-only change (chmod)', () => {
  it('parses a diff with only file mode changes and no hunks', () => {
    const fixture = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
`;

    const result = parseDiff(fixture);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file.filePath).toBe('script.sh');
    expect(file.oldPath).toBeNull();
    expect(file.status).toBe('modified');
    expect(file.isBinary).toBe(false);
    expect(file.hunks).toHaveLength(0);
  });

  it('parses a mode-only change among regular diffs', () => {
    const fixture = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;

    const result = parseDiff(fixture);

    expect(result).toHaveLength(2);

    const scriptDiff = result.find(f => f.filePath === 'script.sh');
    expect(scriptDiff).toBeDefined();
    expect(scriptDiff!.hunks).toHaveLength(0);
    expect(scriptDiff!.status).toBe('modified');

    const appDiff = result.find(f => f.filePath === 'src/app.ts');
    expect(appDiff).toBeDefined();
    expect(appDiff!.hunks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getFileDiffs — survives git difftool's leaked environment
//
// When Glassbox runs as a registered `git difftool`, git exports
// GIT_EXTERNAL_DIFF (plus GIT_DIFF_PATH_COUNTER / GIT_DIFF_PATH_TOTAL) into the
// tool's environment. Inherited by Glassbox's own `git diff --no-index`, that
// var makes the inner git call the external diff driver instead of emitting a
// textual patch — so the diff came back empty and the review reported "No
// changes found for the specified mode". The git() helper scrubs these vars; a
// stand-in external-diff program (`true`, which emits nothing) lets us assert
// that without spawning the real difftool helper (which would recurse).
// ---------------------------------------------------------------------------

describe('getFileDiffs — git difftool environment is scrubbed', () => {
  let cleanup: (() => void) | undefined;
  const saved = {
    ext: process.env.GIT_EXTERNAL_DIFF,
    counter: process.env.GIT_DIFF_PATH_COUNTER,
    total: process.env.GIT_DIFF_PATH_TOTAL,
  };

  afterAll(() => {
    cleanup?.();
    // Restore the ambient environment so other suites are unaffected.
    if (saved.ext === undefined) delete process.env.GIT_EXTERNAL_DIFF;
    else process.env.GIT_EXTERNAL_DIFF = saved.ext;
    if (saved.counter === undefined) delete process.env.GIT_DIFF_PATH_COUNTER;
    else process.env.GIT_DIFF_PATH_COUNTER = saved.counter;
    if (saved.total === undefined) delete process.env.GIT_DIFF_PATH_TOTAL;
    else process.env.GIT_DIFF_PATH_TOTAL = saved.total;
  });

  it('still produces a textual diff for --diff when GIT_EXTERNAL_DIFF is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'glassbox-difftool-env-'));
    cleanup = () => rmSync(dir, { recursive: true, force: true });

    const pathA = join(dir, 'left.txt');
    const pathB = join(dir, 'right.txt');
    writeFileSync(pathA, 'line1\nline2\nline3\n');
    writeFileSync(pathB, 'line1\nCHANGED\nline3\n');

    // Simulate exactly what `git difftool` exports into the tool's env.
    // `true` is a harmless stand-in for the difftool helper: it emits no patch,
    // so an unscrubbed inner `git diff` would yield zero changes.
    process.env.GIT_EXTERNAL_DIFF = 'true';
    process.env.GIT_DIFF_PATH_COUNTER = '1';
    process.env.GIT_DIFF_PATH_TOTAL = '1';

    const diffs = getFileDiffs({ type: 'diff', pathA, pathB }, dir);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].hunks.length).toBeGreaterThan(0);
    const changed = diffs[0].hunks[0].lines.find(
      l => l.type === 'add' && l.content === 'CHANGED',
    );
    expect(changed).toBeDefined();
  });
});
