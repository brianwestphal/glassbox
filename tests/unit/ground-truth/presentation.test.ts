import { describe, expect, it } from 'vitest';

import type { ReviewMode } from '../../../src/git/types.js';
import {
  EXPECTED_KIND_LABELS,
  groundTruthMetaByFileId,
  groundTruthSideLabels,
} from '../../../src/ground-truth/presentation.js';

// doc 26 §26.1 — ground-truth source-list / side-label presentation helpers.
describe('ground-truth presentation', () => {
  const gtMode: ReviewMode = {
    type: 'ground-truth',
    manifestPath: '/m/manifest.json',
    comparisons: [
      { key: 'actual/button.svg', actualPath: '/m/actual/button.svg', expectedPath: '/m/spec/button.svg', label: 'Primary button', expectedKind: 'spec' },
      { key: 'actual/card.png', actualPath: '/m/actual/card.png', expectedPath: '/m/ref/card.png', expectedKind: 'reference' },
      { key: 'actual/plain.png', actualPath: '/m/actual/plain.png', expectedPath: '/m/base/plain.png' },
    ],
  };
  const gitMode: ReviewMode = { type: 'uncommitted' };

  describe('groundTruthSideLabels', () => {
    it('reads Expected (A) / Actual (B) in ground-truth mode', () => {
      expect(groundTruthSideLabels(gtMode)).toEqual({ old: 'Expected (A)', new: 'Actual (B)' });
    });

    it('returns undefined for non-ground-truth modes', () => {
      expect(groundTruthSideLabels(gitMode)).toBeUndefined();
      expect(groundTruthSideLabels({ type: 'commit', sha: 'abc' })).toBeUndefined();
    });
  });

  describe('groundTruthMetaByFileId', () => {
    it('maps each matching file id to its label + expectedKind', () => {
      const files = [
        { id: 'f1', file_path: 'actual/button.svg' },
        { id: 'f2', file_path: 'actual/card.png' },
        { id: 'f3', file_path: 'actual/plain.png' },
      ];
      expect(groundTruthMetaByFileId(gtMode, files)).toEqual({
        f1: { label: 'Primary button', expectedKind: 'spec' },
        f2: { expectedKind: 'reference' },
        f3: {},
      });
    });

    it('omits files whose path is not a manifest key', () => {
      const files = [
        { id: 'f1', file_path: 'actual/button.svg' },
        { id: 'fx', file_path: 'not/in/manifest.png' },
      ];
      const map = groundTruthMetaByFileId(gtMode, files);
      expect(map).toBeDefined();
      expect(Object.keys(map ?? {})).toEqual(['f1']);
    });

    it('returns undefined (not an empty map) for non-ground-truth modes', () => {
      expect(groundTruthMetaByFileId(gitMode, [{ id: 'f1', file_path: 'a.ts' }])).toBeUndefined();
    });
  });

  it('exposes human labels for every expectedKind', () => {
    expect(EXPECTED_KIND_LABELS).toEqual({
      spec: 'Spec',
      reference: 'Reference',
      'previous-actual': 'Baseline',
    });
  });
});
