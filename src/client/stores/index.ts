import { computed, defineStore } from 'kerfjs';

import type {
  AnalysisModeState,
  DragAnnotation,
  FileNotes,
  NarrativeFileOrder,
  ReviewFile,
  RiskFileScore,
  SortMode,
} from '../state.js';
import { defaultAnalysisModeState } from '../state.js';

interface ReviewState {
  reviewId: string;
  currentFileId: string | null;
  files: ReviewFile[];
  annotationCounts: Record<string, number>;
  staleCounts: Record<string, number>;
  filterText: string;
}

export const reviewStore = defineStore({
  initial: (): ReviewState => ({
    reviewId: document.body.dataset.reviewId ?? '',
    currentFileId: null,
    files: [],
    annotationCounts: {},
    staleCounts: {},
    filterText: '',
  }),
  actions: (set, get) => ({
    update: (partial: Partial<ReviewState>) => { set({ ...get(), ...partial }); },
    setAnnotationCount: (fileId: string, count: number) => {
      set({ ...get(), annotationCounts: { ...get().annotationCounts, [fileId]: count } });
    },
    setStaleCount: (fileId: string, count: number) => {
      set({ ...get(), staleCounts: { ...get().staleCounts, [fileId]: count } });
    },
  }),
});

interface DiffViewState {
  diffMode: 'split' | 'unified';
  wrapLines: boolean;
  ignoreWhitespace: boolean;
  lastImageMode: string;
  svgViewMode: 'code' | 'rendered';
  highlightLang: string;
  highlightAuto: boolean;
  detectedLang: string;
  collapsedFolders: Set<string>;
}

export const diffViewStore = defineStore({
  initial: (): DiffViewState => ({
    diffMode: 'split',
    wrapLines: false,
    ignoreWhitespace: false,
    lastImageMode: 'metadata',
    svgViewMode: 'code',
    highlightLang: 'plaintext',
    highlightAuto: true,
    detectedLang: 'plaintext',
    collapsedFolders: new Set(),
  }),
  actions: (set, get) => ({
    update: (partial: Partial<DiffViewState>) => { set({ ...get(), ...partial }); },
    addCollapsedFolder: (path: string) => {
      set({ ...get(), collapsedFolders: new Set([...get().collapsedFolders, path]) });
    },
    removeCollapsedFolder: (path: string) => {
      const next = new Set(get().collapsedFolders);
      next.delete(path);
      set({ ...get(), collapsedFolders: next });
    },
  }),
});

interface AiState {
  sortMode: SortMode;
  riskScores: RiskFileScore[] | null;
  narrativeOrder: NarrativeFileOrder[] | null;
  riskAnalysis: AnalysisModeState;
  narrativeAnalysis: AnalysisModeState;
  aiConfigured: boolean;
  guidedReviewEnabled: boolean;
  riskSortDimension: string;
  showRiskScores: boolean;
  fileNotes: Record<string, FileNotes>;
  guidedAnalysis: AnalysisModeState;
  guidedNotes: Record<string, FileNotes>;
}

export const aiStore = defineStore({
  initial: (): AiState => ({
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
  }),
  actions: (set, get) => ({
    update: (partial: Partial<AiState>) => { set({ ...get(), ...partial }); },
    setFileNote: (fileId: string, notes: FileNotes) => {
      set({ ...get(), fileNotes: { ...get().fileNotes, [fileId]: notes } });
    },
    setGuidedNote: (fileId: string, notes: FileNotes) => {
      set({ ...get(), guidedNotes: { ...get().guidedNotes, [fileId]: notes } });
    },
    setAnalysisState: (
      mode: 'risk' | 'narrative' | 'guided',
      partial: Partial<AnalysisModeState>,
    ) => {
      const key = mode === 'risk' ? 'riskAnalysis'
        : mode === 'narrative' ? 'narrativeAnalysis'
        : 'guidedAnalysis';
      const cur = get();
      set({ ...cur, [key]: { ...cur[key], ...partial } });
    },
  }),
});

export function getAnalysisModeState(mode: 'risk' | 'narrative' | 'guided'): AnalysisModeState {
  const ai = aiStore.state.value;
  if (mode === 'risk') return ai.riskAnalysis;
  if (mode === 'narrative') return ai.narrativeAnalysis;
  return ai.guidedAnalysis;
}

interface DragState {
  annotation: DragAnnotation | null;
}

export const dragStore = defineStore({
  initial: (): DragState => ({ annotation: null }),
  actions: (set) => ({
    setAnnotation: (annotation: DragAnnotation | null) => { set({ annotation }); },
  }),
});

// --- Computed derivations ---

export const filteredFiles = computed(() => {
  const { files, filterText } = reviewStore.state.value;
  if (filterText === '') return files;
  const q = filterText.toLowerCase();
  return files.filter(f => f.file_path.toLowerCase().indexOf(q) !== -1);
});

export const aiEnabled = computed(() =>
  aiStore.state.value.aiConfigured && aiStore.state.value.guidedReviewEnabled,
);

export function fileHasAnnotations(fileId: string): boolean {
  return (reviewStore.state.value.annotationCounts[fileId] ?? 0) > 0;
}

export function fileHasStale(fileId: string): boolean {
  return (reviewStore.state.value.staleCounts[fileId] ?? 0) > 0;
}

// Pure helpers used by both the sidebar render and `visibleFileOrder` computed,
// so keyboard nav (j/k) traverses files in the same order they appear on screen.

function getRiskScoreForDimension(score: RiskFileScore, dimension: string): number {
  if (dimension === 'aggregate') return score.aggregateScore;
  return score.dimensionScores[dimension] ?? 0;
}

export function sortedRiskScores(): RiskFileScore[] {
  const ai = aiStore.state.value;
  const scores = ai.riskScores ?? [];
  const q = reviewStore.state.value.filterText.toLowerCase();
  const filtered = q === '' ? scores : scores.filter(s => s.filePath.toLowerCase().includes(q));
  const dim = ai.riskSortDimension;
  return filtered.slice().sort((a, b) => getRiskScoreForDimension(b, dim) - getRiskScoreForDimension(a, dim));
}

export function sortedNarrativeOrder(): NarrativeFileOrder[] {
  const ai = aiStore.state.value;
  const order = ai.narrativeOrder ?? [];
  const q = reviewStore.state.value.filterText.toLowerCase();
  const filtered = q === '' ? order : order.filter(o => o.filePath.toLowerCase().includes(q));
  return filtered.slice().sort((a, b) => a.position - b.position);
}

export function unscoredFiles(scoredFileIds: Set<string>): ReviewFile[] {
  const review = reviewStore.state.value;
  const q = review.filterText.toLowerCase();
  const unscored = review.files.filter(f => !scoredFileIds.has(f.id));
  return q === '' ? unscored : unscored.filter(f => f.file_path.toLowerCase().includes(q));
}

export const visibleFileOrder = computed<string[]>(() => {
  const ai = aiStore.state.value;
  if (ai.sortMode === 'risk') {
    const scored = sortedRiskScores();
    const scoredIds = new Set((ai.riskScores ?? []).map(s => s.reviewFileId));
    const tail = unscoredFiles(scoredIds);
    return [...scored.map(s => s.reviewFileId), ...tail.map(f => f.id)];
  }
  if (ai.sortMode === 'narrative') {
    const ordered = sortedNarrativeOrder();
    const orderedIds = new Set((ai.narrativeOrder ?? []).map(o => o.reviewFileId));
    const tail = unscoredFiles(orderedIds);
    return [...ordered.map(o => o.reviewFileId), ...tail.map(f => f.id)];
  }
  return folderViewFileOrder();
});

function folderViewFileOrder(): string[] {
  const review = reviewStore.state.value;
  const q = review.filterText.toLowerCase();
  const filtered = q === '' ? review.files : review.files.filter(f => f.file_path.toLowerCase().indexOf(q) !== -1);
  const tree = buildFolderTree(filtered);
  const ids: string[] = [];
  walkTreeFiles(tree, ids);
  return ids;
}

interface TreeNode {
  name: string;
  children: TreeNode[];
  files: ReviewFile[];
}

export function buildFolderTree(files: ReviewFile[]): TreeNode {
  const root: TreeNode = { name: '', children: [], files: [] };
  for (const f of files) {
    const parts = f.file_path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let child = node.children.find(c => c.name === parts[i]);
      if (child === undefined) {
        child = { name: parts[i], children: [], files: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.files.push(f);
  }
  compressFolderTree(root);
  return root;
}

function compressFolderTree(node: TreeNode): void {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    while (child.children.length === 1 && child.files.length === 0) {
      const gc = child.children[0];
      child = { name: child.name + '/' + gc.name, children: gc.children, files: gc.files };
      node.children[i] = child;
    }
    compressFolderTree(child);
  }
}

function walkTreeFiles(node: TreeNode, out: string[]): void {
  const sortedChildren = node.children.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const child of sortedChildren) walkTreeFiles(child, out);
  for (const f of node.files) out.push(f.id);
}

export type { TreeNode };
