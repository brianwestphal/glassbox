import { computed, defineStore, signal } from 'kerfjs';

import { buildFolderTree, walkTreeFiles } from '../sidebar/folderTree.js';
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

// --- Annotation edit-form state ---
// Lives in a signal (not in DOM) so mid-edit form values (content + category)
// survive a sibling annotation update — without this, an unrelated re-render
// of the surrounding list would clobber whatever the user was typing.
export interface EditFormState {
  // `null` annotationId means a brand-new annotation form keyed by `formKey`
  // (line:side) — used by `form.tsx` for create flow. For an in-place edit of
  // an existing annotation, `annotationId` is the row id and `formKey` is
  // unused.
  annotationId: string | null;
  formKey: string | null;
  content: string;
  category: string;
}

export const editFormSignal = signal<EditFormState | null>(null);

export function setEditForm(state: EditFormState | null): void {
  editFormSignal.value = state;
}

export function updateEditFormContent(content: string): void {
  const cur = editFormSignal.value;
  if (cur === null) return;
  editFormSignal.value = { ...cur, content };
}

export function updateEditFormCategory(category: string): void {
  const cur = editFormSignal.value;
  if (cur === null) return;
  editFormSignal.value = { ...cur, category };
}

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

