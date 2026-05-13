export interface ReviewFile {
  id: string;
  file_path: string;
  status: string;
  diff_data: string;
}

export interface Annotation {
  id: string;
  category: string;
  content: string;
  is_stale: boolean;
}

export interface DragAnnotation {
  id: string;
  item: HTMLElement;
  annotation: Annotation;
}

export interface Category {
  value: string;
  label: string;
}

// TreeNode lives in `client/sidebar/folderTree.ts` — import from there
// (it used to live here back when the file held a runtime state object too).

export type SortMode = 'folder' | 'risk' | 'narrative';

export type AnalysisStatusValue = 'idle' | 'running' | 'completed' | 'failed';

export interface AnalysisModeState {
  status: AnalysisStatusValue;
  error: string | null;
  progressCompleted: number;
  progressTotal: number;
}

export function defaultAnalysisModeState(): AnalysisModeState {
  return { status: 'idle', error: null, progressCompleted: 0, progressTotal: 0 };
}

export interface FileNotes {
  overview: string;
  lines: Array<{ line: number; content: string }>;
}

export interface RiskFileScore {
  reviewFileId: string;
  filePath: string;
  aggregateScore: number;
  dimensionScores: Record<string, number>;
  rationale: string;
  sortOrder: number;
}

export interface NarrativeFileOrder {
  reviewFileId: string;
  filePath: string;
  position: number;
  rationale: string;
}

export const CATEGORIES: Category[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'fix', label: 'Fix needed' },
  { value: 'style', label: 'Style' },
  { value: 'pattern-follow', label: 'Pattern to follow' },
  { value: 'pattern-avoid', label: 'Pattern to avoid' },
  { value: 'note', label: 'Note' },
  { value: 'remember', label: 'Remember (for AI)' },
];
