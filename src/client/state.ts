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
}

export const state: AppState = {
  reviewId: document.body.dataset.reviewId!,
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
