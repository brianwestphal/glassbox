import { describe, it, expect } from 'vitest';
import { parseDiff, getDiffArgs, getModeString, getModeArgs } from '../../../src/git/diff.js';
import type { ReviewMode, FileDiff } from '../../../src/git/diff.js';

describe('parseDiff', () => {
  it('parses a simple modification with one hunk', () => {
    const raw = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file.filePath).toBe('src/app.ts');
    expect(file.oldPath).toBeNull();
    expect(file.status).toBe('modified');
    expect(file.isBinary).toBe(false);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(4);

    expect(hunk.lines).toHaveLength(5);
    expect(hunk.lines[0]).toEqual({ type: 'context', oldNum: 1, newNum: 1, content: 'const a = 1;' });
    expect(hunk.lines[1]).toEqual({ type: 'remove', oldNum: 2, newNum: null, content: 'const b = 2;' });
    expect(hunk.lines[2]).toEqual({ type: 'add', oldNum: null, newNum: 2, content: 'const b = 3;' });
    expect(hunk.lines[3]).toEqual({ type: 'add', oldNum: null, newNum: 3, content: 'const c = 4;' });
    expect(hunk.lines[4]).toEqual({ type: 'context', oldNum: 3, newNum: 4, content: 'const d = 5;' });
  });

  it('parses a new file', () => {
    const raw = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,3 @@
+line one
+line two
+line three
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file.filePath).toBe('new-file.ts');
    expect(file.oldPath).toBeNull();
    expect(file.status).toBe('added');
    expect(file.isBinary).toBe(false);

    expect(file.hunks).toHaveLength(1);
    const hunk = file.hunks[0];
    expect(hunk.oldStart).toBe(0);
    expect(hunk.oldCount).toBe(0);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(3);

    expect(hunk.lines).toHaveLength(3);
    for (const line of hunk.lines) {
      expect(line.type).toBe('add');
      expect(line.oldNum).toBeNull();
    }
    expect(hunk.lines[0].newNum).toBe(1);
    expect(hunk.lines[1].newNum).toBe(2);
    expect(hunk.lines[2].newNum).toBe(3);
    expect(hunk.lines[0].content).toBe('line one');
    expect(hunk.lines[1].content).toBe('line two');
    expect(hunk.lines[2].content).toBe('line three');
  });

  it('parses a deleted file', () => {
    const raw = `diff --git a/old-file.ts b/old-file.ts
deleted file mode 100644
index abc1234..0000000
--- a/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file.filePath).toBe('old-file.ts');
    expect(file.oldPath).toBeNull();
    expect(file.status).toBe('deleted');
    expect(file.isBinary).toBe(false);

    expect(file.hunks).toHaveLength(1);
    const hunk = file.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(2);
    expect(hunk.newStart).toBe(0);
    expect(hunk.newCount).toBe(0);

    expect(hunk.lines).toHaveLength(2);
    for (const line of hunk.lines) {
      expect(line.type).toBe('remove');
      expect(line.newNum).toBeNull();
    }
    expect(hunk.lines[0]).toEqual({ type: 'remove', oldNum: 1, newNum: null, content: 'line one' });
    expect(hunk.lines[1]).toEqual({ type: 'remove', oldNum: 2, newNum: null, content: 'line two' });
  });

  it('parses a renamed file', () => {
    const raw = `diff --git a/old-name.ts b/new-name.ts
similarity index 90%
rename from old-name.ts
rename to new-name.ts
index abc1234..def5678 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,3 +1,3 @@
 unchanged
-old line
+new line
 unchanged
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file.filePath).toBe('new-name.ts');
    expect(file.oldPath).toBe('old-name.ts');
    expect(file.status).toBe('renamed');
    expect(file.isBinary).toBe(false);

    expect(file.hunks).toHaveLength(1);
    const hunk = file.hunks[0];
    expect(hunk.lines).toHaveLength(4);
    expect(hunk.lines[0]).toEqual({ type: 'context', oldNum: 1, newNum: 1, content: 'unchanged' });
    expect(hunk.lines[1]).toEqual({ type: 'remove', oldNum: 2, newNum: null, content: 'old line' });
    expect(hunk.lines[2]).toEqual({ type: 'add', oldNum: null, newNum: 2, content: 'new line' });
    expect(hunk.lines[3]).toEqual({ type: 'context', oldNum: 3, newNum: 3, content: 'unchanged' });
  });

  it('parses a multi-hunk file', () => {
    const raw = `diff --git a/multi.ts b/multi.ts
index abc1234..def5678 100644
--- a/multi.ts
+++ b/multi.ts
@@ -1,3 +1,4 @@
 line 1
+inserted
 line 2
 line 3
@@ -10,3 +11,3 @@
 line 10
-old
+new
 line 12
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file.filePath).toBe('multi.ts');
    expect(file.status).toBe('modified');
    expect(file.hunks).toHaveLength(2);

    // First hunk
    const hunk1 = file.hunks[0];
    expect(hunk1.oldStart).toBe(1);
    expect(hunk1.oldCount).toBe(3);
    expect(hunk1.newStart).toBe(1);
    expect(hunk1.newCount).toBe(4);
    expect(hunk1.lines).toHaveLength(4);
    expect(hunk1.lines[0]).toEqual({ type: 'context', oldNum: 1, newNum: 1, content: 'line 1' });
    expect(hunk1.lines[1]).toEqual({ type: 'add', oldNum: null, newNum: 2, content: 'inserted' });
    expect(hunk1.lines[2]).toEqual({ type: 'context', oldNum: 2, newNum: 3, content: 'line 2' });
    expect(hunk1.lines[3]).toEqual({ type: 'context', oldNum: 3, newNum: 4, content: 'line 3' });

    // Second hunk
    const hunk2 = file.hunks[1];
    expect(hunk2.oldStart).toBe(10);
    expect(hunk2.oldCount).toBe(3);
    expect(hunk2.newStart).toBe(11);
    expect(hunk2.newCount).toBe(3);
    expect(hunk2.lines).toHaveLength(4);
    expect(hunk2.lines[0]).toEqual({ type: 'context', oldNum: 10, newNum: 11, content: 'line 10' });
    expect(hunk2.lines[1]).toEqual({ type: 'remove', oldNum: 11, newNum: null, content: 'old' });
    expect(hunk2.lines[2]).toEqual({ type: 'add', oldNum: null, newNum: 12, content: 'new' });
    expect(hunk2.lines[3]).toEqual({ type: 'context', oldNum: 12, newNum: 13, content: 'line 12' });
  });

  it('parses a multi-file diff', () => {
    const raw = `diff --git a/file1.ts b/file1.ts
index abc1234..def5678 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,2 @@
 unchanged
-old
+new
diff --git a/file2.ts b/file2.ts
index abc1234..def5678 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,3 @@
 line 1
+added line
 line 2
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(2);
    expect(result[0].filePath).toBe('file1.ts');
    expect(result[1].filePath).toBe('file2.ts');
    expect(result[0].hunks).toHaveLength(1);
    expect(result[1].hunks).toHaveLength(1);
  });

  it('parses a binary file', () => {
    const raw = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/image.png differ
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file.filePath).toBe('image.png');
    expect(file.isBinary).toBe(true);
    expect(file.status).toBe('added');
    expect(file.hunks).toEqual([]);
  });

  it('skips no-newline-at-EOF markers', () => {
    const raw = `diff --git a/no-nl.ts b/no-nl.ts
index abc1234..def5678 100644
--- a/no-nl.ts
+++ b/no-nl.ts
@@ -1,2 +1,2 @@
 line one
-line two
\\ No newline at end of file
+line two fixed
\\ No newline at end of file
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const file = result[0];
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0];
    // Only real content lines should be present, no '\' lines
    const backslashLines = hunk.lines.filter(l => l.content.startsWith('\\') || l.content.includes('No newline'));
    expect(backslashLines).toHaveLength(0);

    expect(hunk.lines).toHaveLength(3);
    expect(hunk.lines[0]).toEqual({ type: 'context', oldNum: 1, newNum: 1, content: 'line one' });
    expect(hunk.lines[1]).toEqual({ type: 'remove', oldNum: 2, newNum: null, content: 'line two' });
    expect(hunk.lines[2]).toEqual({ type: 'add', oldNum: null, newNum: 2, content: 'line two fixed' });
  });

  it('returns empty array for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('handles hunk header without count (defaults to 1)', () => {
    const raw = `diff --git a/single.ts b/single.ts
index abc1234..def5678 100644
--- a/single.ts
+++ b/single.ts
@@ -1 +1,2 @@
 existing line
+new line
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const hunk = result[0].hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(2);
  });

  it('tracks line numbers correctly through a complex hunk', () => {
    const raw = `diff --git a/complex.ts b/complex.ts
index abc1234..def5678 100644
--- a/complex.ts
+++ b/complex.ts
@@ -5,9 +5,10 @@
 line 5
 line 6
-line 7 old
-line 8 old
+line 7 new
+line 8 new
+line 8b inserted
 line 9
-line 10 removed
 line 11
+line 11b inserted
 line 12
`;

    const result = parseDiff(raw);

    expect(result).toHaveLength(1);
    const hunk = result[0].hunks[0];
    expect(hunk.oldStart).toBe(5);
    expect(hunk.newStart).toBe(5);

    // Verify each line's numbers carefully
    // line 5 - context
    expect(hunk.lines[0]).toEqual({ type: 'context', oldNum: 5, newNum: 5, content: 'line 5' });
    // line 6 - context
    expect(hunk.lines[1]).toEqual({ type: 'context', oldNum: 6, newNum: 6, content: 'line 6' });
    // line 7 old - remove (oldNum=7)
    expect(hunk.lines[2]).toEqual({ type: 'remove', oldNum: 7, newNum: null, content: 'line 7 old' });
    // line 8 old - remove (oldNum=8)
    expect(hunk.lines[3]).toEqual({ type: 'remove', oldNum: 8, newNum: null, content: 'line 8 old' });
    // line 7 new - add (newNum=7)
    expect(hunk.lines[4]).toEqual({ type: 'add', oldNum: null, newNum: 7, content: 'line 7 new' });
    // line 8 new - add (newNum=8)
    expect(hunk.lines[5]).toEqual({ type: 'add', oldNum: null, newNum: 8, content: 'line 8 new' });
    // line 8b inserted - add (newNum=9)
    expect(hunk.lines[6]).toEqual({ type: 'add', oldNum: null, newNum: 9, content: 'line 8b inserted' });
    // line 9 - context (oldNum=9, newNum=10)
    expect(hunk.lines[7]).toEqual({ type: 'context', oldNum: 9, newNum: 10, content: 'line 9' });
    // line 10 removed - remove (oldNum=10)
    expect(hunk.lines[8]).toEqual({ type: 'remove', oldNum: 10, newNum: null, content: 'line 10 removed' });
    // line 11 - context (oldNum=11, newNum=11)
    expect(hunk.lines[9]).toEqual({ type: 'context', oldNum: 11, newNum: 11, content: 'line 11' });
    // line 11b inserted - add (newNum=12)
    expect(hunk.lines[10]).toEqual({ type: 'add', oldNum: null, newNum: 12, content: 'line 11b inserted' });
    // line 12 - context (oldNum=12, newNum=13)
    expect(hunk.lines[11]).toEqual({ type: 'context', oldNum: 12, newNum: 13, content: 'line 12' });
  });
});

describe('getDiffArgs', () => {
  it('returns correct args for uncommitted mode', () => {
    expect(getDiffArgs({ type: 'uncommitted' })).toBe('diff HEAD');
  });

  it('returns correct args for staged mode', () => {
    expect(getDiffArgs({ type: 'staged' })).toBe('diff --cached');
  });

  it('returns correct args for unstaged mode', () => {
    expect(getDiffArgs({ type: 'unstaged' })).toBe('diff');
  });

  it('returns correct args for commit mode', () => {
    expect(getDiffArgs({ type: 'commit', sha: 'abc' })).toBe('diff abc~1 abc');
  });

  it('returns correct args for range mode', () => {
    expect(getDiffArgs({ type: 'range', from: 'a', to: 'b' })).toBe('diff a b');
  });

  it('returns correct args for branch mode', () => {
    expect(getDiffArgs({ type: 'branch', name: 'main' })).toBe('diff main...HEAD');
  });

  it('returns correct args for files mode', () => {
    expect(getDiffArgs({ type: 'files', patterns: ['*.ts', '*.js'] })).toBe('diff HEAD -- *.ts *.js');
  });

  it('returns correct args for all mode', () => {
    expect(getDiffArgs({ type: 'all' })).toBe('diff --no-index /dev/null .');
  });
});

describe('getModeString', () => {
  it('returns "uncommitted" for uncommitted mode', () => {
    expect(getModeString({ type: 'uncommitted' })).toBe('uncommitted');
  });

  it('returns "staged" for staged mode', () => {
    expect(getModeString({ type: 'staged' })).toBe('staged');
  });

  it('returns "unstaged" for unstaged mode', () => {
    expect(getModeString({ type: 'unstaged' })).toBe('unstaged');
  });

  it('returns "commit:<sha>" for commit mode', () => {
    expect(getModeString({ type: 'commit', sha: 'abc' })).toBe('commit:abc');
  });

  it('returns "range:<from>..<to>" for range mode', () => {
    expect(getModeString({ type: 'range', from: 'a', to: 'b' })).toBe('range:a..b');
  });

  it('returns "branch:<name>" for branch mode', () => {
    expect(getModeString({ type: 'branch', name: 'main' })).toBe('branch:main');
  });

  it('returns "files:<patterns>" for files mode', () => {
    expect(getModeString({ type: 'files', patterns: ['*.ts'] })).toBe('files:*.ts');
  });

  it('returns comma-separated patterns for multiple file patterns', () => {
    expect(getModeString({ type: 'files', patterns: ['*.ts', '*.js'] })).toBe('files:*.ts,*.js');
  });

  it('returns "all" for all mode', () => {
    expect(getModeString({ type: 'all' })).toBe('all');
  });
});

describe('getModeArgs', () => {
  it('returns undefined for uncommitted mode', () => {
    expect(getModeArgs({ type: 'uncommitted' })).toBeUndefined();
  });

  it('returns undefined for staged mode', () => {
    expect(getModeArgs({ type: 'staged' })).toBeUndefined();
  });

  it('returns undefined for unstaged mode', () => {
    expect(getModeArgs({ type: 'unstaged' })).toBeUndefined();
  });

  it('returns sha for commit mode', () => {
    expect(getModeArgs({ type: 'commit', sha: 'abc' })).toBe('abc');
  });

  it('returns "from..to" for range mode', () => {
    expect(getModeArgs({ type: 'range', from: 'a', to: 'b' })).toBe('a..b');
  });

  it('returns branch name for branch mode', () => {
    expect(getModeArgs({ type: 'branch', name: 'main' })).toBe('main');
  });

  it('returns comma-separated patterns for files mode', () => {
    expect(getModeArgs({ type: 'files', patterns: ['*.ts', '*.js'] })).toBe('*.ts,*.js');
  });

  it('returns undefined for all mode', () => {
    expect(getModeArgs({ type: 'all' })).toBeUndefined();
  });
});
