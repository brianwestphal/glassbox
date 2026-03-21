/**
 * Character-level diff for highlighting inline changes.
 * Uses a simple LCS-based approach to identify which characters changed
 * between two strings, returning segments marked as changed or unchanged.
 */

export interface DiffSegment {
  text: string;
  changed: boolean;
}

/**
 * Compute character-level diff segments for the old and new strings.
 * Returns two arrays: one for the old side, one for the new side.
 * Only computes if the strings are sufficiently similar (> 20% common).
 */
export function charDiff(oldStr: string, newStr: string): { oldSegments: DiffSegment[]; newSegments: DiffSegment[] } | null {
  if (!oldStr && !newStr) return null;
  if (oldStr === newStr) return null;

  // Compute LCS length to check similarity
  const lcs = lcsTable(oldStr, newStr);
  const lcsLen = lcs[oldStr.length][newStr.length];
  const maxLen = Math.max(oldStr.length, newStr.length);
  if (maxLen === 0) return null;

  // Only highlight if strings share >20% of characters (otherwise it's a full rewrite)
  if (lcsLen / maxLen < 0.2) return null;

  // Backtrace to get the actual common subsequence positions
  const oldCommon = new Set<number>();
  const newCommon = new Set<number>();
  let i = oldStr.length, j = newStr.length;
  while (i > 0 && j > 0) {
    if (oldStr[i - 1] === newStr[j - 1]) {
      oldCommon.add(i - 1);
      newCommon.add(j - 1);
      i--; j--;
    } else if (lcs[i - 1][j] > lcs[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return {
    oldSegments: buildSegments(oldStr, oldCommon),
    newSegments: buildSegments(newStr, newCommon),
  };
}

function lcsTable(a: string, b: string): number[][] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function buildSegments(str: string, commonPositions: Set<number>): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let current = '';
  let currentChanged = false;

  for (let i = 0; i < str.length; i++) {
    const changed = !commonPositions.has(i);
    if (changed !== currentChanged && current.length > 0) {
      segments.push({ text: current, changed: currentChanged });
      current = '';
    }
    currentChanged = changed;
    current += str[i];
  }
  if (current.length > 0) {
    segments.push({ text: current, changed: currentChanged });
  }
  return segments;
}
