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
  fileOrder: string[];
  annotationCounts: Record<string, number>;
  staleCounts: Record<string, number>;
  filterText: string;
}

export const reviewStore = defineStore({
  initial: (): ReviewState => ({
    reviewId: document.body.dataset.reviewId ?? '',
    currentFileId: null,
    files: [],
    fileOrder: [],
    annotationCounts: {},
    staleCounts: {},
    filterText: '',
  }),
  actions: (set, get) => ({
    update: (partial: Partial<ReviewState>) => { set({ ...get(), ...partial }); },
    pushFileOrder: (id: string) => { set({ ...get(), fileOrder: [...get().fileOrder, id] }); },
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
