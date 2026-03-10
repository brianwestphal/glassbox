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

interface TreeNode {
  name: string;
  children: TreeNode[];
  files: ReviewFile[];
}

export type { TreeNode };

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

export function getAnalysisState(mode: 'risk' | 'narrative'): AnalysisModeState {
  return mode === 'risk' ? state.riskAnalysis : state.narrativeAnalysis;
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

export interface AppState {
  reviewId: string;
  currentFileId: string | null;
  diffMode: 'split' | 'unified';
  wrapLines: boolean;
  files: ReviewFile[];
  fileOrder: string[];
  annotationCounts: Record<string, number>;
  staleCounts: Record<string, number>;
  filterText: string;
  highlightLang: string;
  highlightAuto: boolean;
  _detectedLang: string;
  _dragAnnotation: DragAnnotation | null;
  collapsedFolders: Set<string>;
  // AI sorting
  sortMode: SortMode;
  riskScores: RiskFileScore[] | null;
  narrativeOrder: NarrativeFileOrder[] | null;
  riskAnalysis: AnalysisModeState;
  narrativeAnalysis: AnalysisModeState;
  aiConfigured: boolean;
  guidedReviewEnabled: boolean;
  riskSortDimension: string;
  showRiskScores: boolean;
  // AI notes keyed by reviewFileId
  fileNotes: Record<string, FileNotes>;
  // Guided review (separate from risk/narrative)
  guidedAnalysis: AnalysisModeState;
  guidedNotes: Record<string, FileNotes>;
}

export const state: AppState = {
  reviewId: document.body.dataset.reviewId ?? '',
  currentFileId: null,
  diffMode: 'split',
  wrapLines: false,
  files: [],
  fileOrder: [],
  annotationCounts: {},
  staleCounts: {},
  filterText: '',
  highlightLang: 'plaintext',
  highlightAuto: true,
  _detectedLang: 'plaintext',
  _dragAnnotation: null,
  collapsedFolders: new Set(),
  // AI sorting
  sortMode: 'folder',
  riskScores: null,
  narrativeOrder: null,
  riskAnalysis: defaultAnalysisModeState(),
  narrativeAnalysis: defaultAnalysisModeState(),
  aiConfigured: false,
  guidedReviewEnabled: false,
  riskSortDimension: 'aggregate',
  showRiskScores: false,
  fileNotes: {},
  guidedAnalysis: defaultAnalysisModeState(),
  guidedNotes: {},
};

export const CATEGORIES: Category[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'fix', label: 'Fix needed' },
  { value: 'style', label: 'Style' },
  { value: 'pattern-follow', label: 'Pattern to follow' },
  { value: 'pattern-avoid', label: 'Pattern to avoid' },
  { value: 'note', label: 'Note' },
  { value: 'remember', label: 'Remember (for AI)' },
];
