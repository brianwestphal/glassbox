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

export type ReviewMode =
  | { type: 'uncommitted' }
  | { type: 'staged' }
  | { type: 'unstaged' }
  | { type: 'commit'; sha: string }
  | { type: 'range'; from: string; to: string }
  | { type: 'branch'; name: string }
  | { type: 'files'; patterns: string[] }
  | { type: 'all' };
