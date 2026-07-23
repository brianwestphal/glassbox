/**
 * Unit tests for the client store layer (src/client/stores/index.ts) — the
 * four kerf stores, the edit-form signal, and the computed derivations behind
 * the sidebar (`filteredFiles`, `visibleFileOrder`, `folderModeFiles`).
 *
 * The module reads `document.body.dataset` at import time and this repo runs
 * vitest in the node environment — stub the minimal DOM surface BEFORE the
 * module loads, then import dynamically (same pattern as analysisEngine.test).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('document', { body: { dataset: {} } });

const stores = await import('../../../src/client/stores/index.js');
const {
  aiStore,
  diffViewStore,
  dragStore,
  editFormSignal,
  fileHasAnnotations,
  fileHasStale,
  filteredFiles,
  folderModeFiles,
  getAnalysisModeState,
  hasIdenticalFiles,
  isGroundTruthReview,
  groundTruthMeta,
  reviewStore,
  setEditForm,
  sortedRiskScores,
  updateEditFormCategory,
  updateEditFormContent,
  visibleFileOrder,
} = stores;
const { defaultAnalysisModeState } = await import('../../../src/client/state.js');

import type { ReviewFile, RiskFileScore } from '../../../src/client/state.js';

function mkFile(id: string, path: string, extra: Partial<ReviewFile> = {}): ReviewFile {
  return {
    id,
    review_id: 'r1',
    file_path: path,
    status: 'pending',
    diff_data: null,
    created_at: '2026-01-01',
    ...extra,
  };
}

function mkScore(reviewFileId: string, filePath: string, aggregate: number, dims: Record<string, number> = {}): RiskFileScore {
  return { reviewFileId, filePath, aggregateScore: aggregate, dimensionScores: dims, rationale: '', sortOrder: 0 };
}

/** Reset every store to a known baseline between tests (module state is shared). */
beforeEach(() => {
  reviewStore.actions.update({
    currentFileId: null,
    files: [],
    annotationCounts: {},
    staleCounts: {},
    filterText: '',
    groundTruth: {},
    pluginRendered: new Set<string>(),
  });
  diffViewStore.actions.update({
    collapsedFolders: new Set<string>(),
    hideIdentical: true,
  });
  aiStore.actions.update({
    sortMode: 'folder',
    riskScores: null,
    narrativeOrder: null,
    riskAnalysis: defaultAnalysisModeState(),
    narrativeAnalysis: defaultAnalysisModeState(),
    guidedAnalysis: defaultAnalysisModeState(),
    riskSortDimension: 'aggregate',
    fileNotes: {},
    guidedNotes: {},
  });
  dragStore.actions.setAnnotation(null);
  setEditForm(null);
});

describe('filteredFiles', () => {
  const files = [mkFile('a', 'src/auth/session.ts'), mkFile('b', 'src/db/redis.ts'), mkFile('c', 'README.md')];

  it('filter → empty result → clear → full list again (empty-then-refill)', () => {
    reviewStore.actions.update({ files });
    expect(filteredFiles.value).toHaveLength(3);

    reviewStore.actions.update({ filterText: 'no-such-file' });
    expect(filteredFiles.value).toHaveLength(0);

    reviewStore.actions.update({ filterText: '' });
    expect(filteredFiles.value).toHaveLength(3);
  });

  it('matches case-insensitively on the path substring', () => {
    reviewStore.actions.update({ files, filterText: 'AUTH' });
    expect(filteredFiles.value.map(f => f.id)).toEqual(['a']);
  });
});

describe('visibleFileOrder in risk mode with partial scores', () => {
  const files = [mkFile('a', 'a.ts'), mkFile('b', 'b.ts'), mkFile('c', 'c.ts'), mkFile('d', 'd.ts')];

  it('scored files sort by aggregate desc, unscored files trail in folder order', () => {
    reviewStore.actions.update({ files });
    aiStore.actions.update({
      sortMode: 'risk',
      riskScores: [mkScore('b', 'b.ts', 3), mkScore('d', 'd.ts', 9)],
    });
    expect(visibleFileOrder.value).toEqual(['d', 'b', 'a', 'c']);
  });

  it('risk dimension select reorders by that dimension, missing dimension scores as 0', () => {
    reviewStore.actions.update({ files });
    aiStore.actions.update({
      sortMode: 'risk',
      riskScores: [
        mkScore('a', 'a.ts', 9, { security: 1 }),
        mkScore('b', 'b.ts', 1, { security: 8 }),
        mkScore('c', 'c.ts', 5, {}), // no security score → 0
      ],
      riskSortDimension: 'security',
    });
    expect(sortedRiskScores().map(s => s.reviewFileId)).toEqual(['b', 'a', 'c']);
    expect(visibleFileOrder.value).toEqual(['b', 'a', 'c', 'd']);
  });

  it('the text filter applies to scored and unscored files alike', () => {
    reviewStore.actions.update({
      files: [mkFile('a', 'src/auth.ts'), mkFile('b', 'src/db.ts'), mkFile('c', 'lib/auth-helper.ts')],
      filterText: 'auth',
    });
    aiStore.actions.update({ sortMode: 'risk', riskScores: [mkScore('a', 'src/auth.ts', 5)] });
    // 'b' (scored: no; filtered out), 'c' unscored but matches → tail.
    expect(visibleFileOrder.value).toEqual(['a', 'c']);
  });
});

describe('visibleFileOrder in narrative mode', () => {
  it('ordered files sort by position, unscored trail', () => {
    reviewStore.actions.update({ files: [mkFile('a', 'a.ts'), mkFile('b', 'b.ts'), mkFile('c', 'c.ts')] });
    aiStore.actions.update({
      sortMode: 'narrative',
      narrativeOrder: [
        { reviewFileId: 'c', filePath: 'c.ts', position: 1, rationale: '' },
        { reviewFileId: 'a', filePath: 'a.ts', position: 2, rationale: '' },
      ],
    });
    expect(visibleFileOrder.value).toEqual(['c', 'a', 'b']);
  });
});

describe('folderModeFiles: hideIdentical × filter cross-product (doc 26 P2)', () => {
  const files = [
    mkFile('same', 'shots/identical.png', { difference_score: 0 }),
    mkFile('diff', 'shots/changed.png', { difference_score: 0.4 }),
    mkFile('plain', 'src/code.ts', { difference_score: null }),
  ];

  it('hideIdentical on + no filter: identical pair hidden, null score kept', () => {
    reviewStore.actions.update({ files });
    expect(folderModeFiles().map(f => f.id)).toEqual(['diff', 'plain']);
  });

  it('hideIdentical off + no filter: everything visible', () => {
    reviewStore.actions.update({ files });
    diffViewStore.actions.update({ hideIdentical: false });
    expect(folderModeFiles().map(f => f.id)).toEqual(['same', 'diff', 'plain']);
  });

  it('hideIdentical on + filter: both constraints apply', () => {
    reviewStore.actions.update({ files, filterText: 'png' });
    expect(folderModeFiles().map(f => f.id)).toEqual(['diff']);
  });

  it('hideIdentical off + filter: filter alone applies', () => {
    reviewStore.actions.update({ files, filterText: 'png' });
    diffViewStore.actions.update({ hideIdentical: false });
    expect(folderModeFiles().map(f => f.id)).toEqual(['same', 'diff']);
  });

  it('filter also matches the ground-truth comparison label', () => {
    reviewStore.actions.update({
      files,
      filterText: 'login flow',
      groundTruth: { diff: { label: 'Login flow step 2' } },
    });
    expect(folderModeFiles().map(f => f.id)).toEqual(['diff']);
  });

  it('hidden and filtered files are excluded from keyboard-nav order too', () => {
    // The documented invariant: visibleFileOrder matches what folderModeFiles
    // renders, so j/k never lands on an invisible file.
    reviewStore.actions.update({ files });
    expect(visibleFileOrder.value.sort()).toEqual(folderModeFiles().map(f => f.id).sort());
  });
});

describe('collapsedFolders across sort-mode round-trips', () => {
  it('a collapsed folder survives folder→risk→folder', () => {
    diffViewStore.actions.addCollapsedFolder('src/auth');
    aiStore.actions.update({ sortMode: 'risk' });
    aiStore.actions.update({ sortMode: 'folder' });
    expect(diffViewStore.state.value.collapsedFolders.has('src/auth')).toBe(true);
  });

  it('add and remove are non-mutating set updates', () => {
    diffViewStore.actions.addCollapsedFolder('a');
    const snapshot = diffViewStore.state.value.collapsedFolders;
    diffViewStore.actions.addCollapsedFolder('b');
    expect(snapshot.has('b')).toBe(false); // old snapshot untouched
    expect(diffViewStore.state.value.collapsedFolders.has('a')).toBe(true);
    diffViewStore.actions.removeCollapsedFolder('a');
    expect(diffViewStore.state.value.collapsedFolders.has('a')).toBe(false);
    expect(diffViewStore.state.value.collapsedFolders.has('b')).toBe(true);
  });
});

describe('reviewStore per-file counters and status', () => {
  it('annotation/stale counts drive the has* helpers', () => {
    expect(fileHasAnnotations('f1')).toBe(false);
    reviewStore.actions.setAnnotationCount('f1', 2);
    expect(fileHasAnnotations('f1')).toBe(true);
    reviewStore.actions.setAnnotationCount('f1', 0);
    expect(fileHasAnnotations('f1')).toBe(false);

    expect(fileHasStale('f1')).toBe(false);
    reviewStore.actions.setStaleCount('f1', 1);
    expect(fileHasStale('f1')).toBe(true);
  });

  it('setFileStatus updates exactly the targeted file', () => {
    reviewStore.actions.update({ files: [mkFile('a', 'a.ts'), mkFile('b', 'b.ts')] });
    reviewStore.actions.setFileStatus('a', 'reviewed');
    const byId = new Map(reviewStore.state.value.files.map(f => [f.id, f.status]));
    expect(byId.get('a')).toBe('reviewed');
    expect(byId.get('b')).toBe('pending');
  });
});

describe('ground-truth helpers', () => {
  it('isGroundTruthReview keys off the groundTruth record', () => {
    expect(isGroundTruthReview()).toBe(false);
    reviewStore.actions.update({ groundTruth: { a: { label: 'Shot A' } } });
    expect(isGroundTruthReview()).toBe(true);
    expect(groundTruthMeta('a')).toEqual({ label: 'Shot A' });
    expect(groundTruthMeta('missing')).toBeUndefined();
  });

  it('hasIdenticalFiles detects a 0-score file', () => {
    reviewStore.actions.update({ files: [mkFile('a', 'a.png', { difference_score: 0.2 })] });
    expect(hasIdenticalFiles()).toBe(false);
    reviewStore.actions.update({ files: [mkFile('a', 'a.png', { difference_score: 0 })] });
    expect(hasIdenticalFiles()).toBe(true);
  });
});

describe('aiStore per-mode analysis state isolation', () => {
  it('setAnalysisState touches only the addressed mode', () => {
    aiStore.actions.setAnalysisState('risk', { status: 'running', progressCompleted: 1, progressTotal: 4 });
    aiStore.actions.setAnalysisState('guided', { status: 'failed', error: 'boom' });

    expect(getAnalysisModeState('risk')).toMatchObject({ status: 'running', progressCompleted: 1 });
    expect(getAnalysisModeState('guided')).toMatchObject({ status: 'failed', error: 'boom' });
    expect(getAnalysisModeState('narrative')).toMatchObject({ status: 'idle', error: null });
  });

  it('partial updates merge into the existing mode state', () => {
    aiStore.actions.setAnalysisState('narrative', { status: 'running', progressTotal: 10 });
    aiStore.actions.setAnalysisState('narrative', { progressCompleted: 3 });
    expect(getAnalysisModeState('narrative')).toMatchObject({
      status: 'running', progressCompleted: 3, progressTotal: 10,
    });
  });
});

describe('editFormSignal', () => {
  it('content/category updates preserve the rest of the form state', () => {
    setEditForm({ annotationId: 'ann1', formKey: null, content: 'first', category: 'bug' });
    updateEditFormContent('second draft');
    updateEditFormCategory('fix');
    expect(editFormSignal.value).toMatchObject({
      annotationId: 'ann1', content: 'second draft', category: 'fix',
    });
  });

  it('updates are no-ops when no form is open', () => {
    updateEditFormContent('typed into the void');
    updateEditFormCategory('bug');
    expect(editFormSignal.value).toBeNull();
  });
});

describe('dragStore', () => {
  it('set and clear round-trip', () => {
    const annotation = { id: 'ann1', category: 'bug', content: 'x', is_stale: false };
    dragStore.actions.setAnnotation({ id: 'ann1', item: {} as HTMLElement, annotation });
    expect(dragStore.state.value.annotation?.id).toBe('ann1');
    dragStore.actions.setAnnotation(null);
    expect(dragStore.state.value.annotation).toBeNull();
  });
});
