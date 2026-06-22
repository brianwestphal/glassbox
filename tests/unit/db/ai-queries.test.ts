import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDb, teardownTestDb } from '../../helpers/db.js';

import { getDb } from '../../../src/db/connection.js';

// vi.mock must come before imports of the modules being tested
vi.mock('../../../src/db/connection.js', () => ({
  getDb: vi.fn(),
}));

// We need createReview + addReviewFile to set up foreign key parents
import { createReview, addReviewFile } from '../../../src/db/queries.js';

import {
  createAnalysis,
  updateAnalysisStatus,
  updateAnalysisProgress,
  getLatestAnalysis,
  saveFileScores,
  appendFileScores,
  getFileScores,
  getFileScoresForReview,
  getPreviousScores,
  getUserPreferences,
  saveUserPreferences,
} from '../../../src/db/ai-queries.js';

describe('ai-queries', () => {
  beforeAll(async () => {
    const db = await setupTestDb();
    vi.mocked(getDb).mockResolvedValue(db);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  // --- AI Analyses ---

  describe('AI Analyses', () => {
    it('createAnalysis creates with status running', async () => {
      const review = await createReview('/repo/ai', 'ai-repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      expect(analysis.id).toBeDefined();
      expect(analysis.review_id).toBe(review.id);
      expect(analysis.analysis_type).toBe('risk');
      expect(analysis.status).toBe('running');
      expect(analysis.error_message).toBeNull();
      expect(analysis.progress_completed).toBe(0);
      expect(analysis.progress_total).toBe(0);
      expect(analysis.created_at).toBeDefined();
      expect(analysis.updated_at).toBeDefined();
    });

    it('updateAnalysisStatus changes status', async () => {
      const review = await createReview('/repo/ai-status', 'repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      await updateAnalysisStatus(analysis.id, 'completed');
      const updated = await getLatestAnalysis(review.id, 'risk');
      expect(updated!.status).toBe('completed');
      expect(updated!.error_message).toBeNull();
    });

    it('updateAnalysisStatus sets error message', async () => {
      const review = await createReview('/repo/ai-error', 'repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      await updateAnalysisStatus(analysis.id, 'failed', 'API key invalid');
      const updated = await getLatestAnalysis(review.id, 'risk');
      expect(updated!.status).toBe('failed');
      expect(updated!.error_message).toBe('API key invalid');
    });

    it('updateAnalysisProgress tracks progress', async () => {
      const review = await createReview('/repo/ai-progress', 'repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      await updateAnalysisProgress(analysis.id, 3, 10);
      const updated = await getLatestAnalysis(review.id, 'risk');
      expect(updated!.progress_completed).toBe(3);
      expect(updated!.progress_total).toBe(10);
    });

    it('getLatestAnalysis returns most recent for type', async () => {
      const review = await createReview('/repo/ai-latest', 'repo', 'uncommitted');
      const a1 = await createAnalysis(review.id, 'risk');
      // Small delay to ensure distinct created_at timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const a2 = await createAnalysis(review.id, 'risk');

      const latest = await getLatestAnalysis(review.id, 'risk');
      expect(latest).toBeDefined();
      expect(latest!.id).toBe(a2.id);
    });

    it('getLatestAnalysis returns undefined when none exist', async () => {
      const review = await createReview('/repo/ai-none', 'repo', 'uncommitted');
      const result = await getLatestAnalysis(review.id, 'narrative');
      expect(result).toBeUndefined();
    });

    it('getLatestAnalysis distinguishes analysis types', async () => {
      const review = await createReview('/repo/ai-types', 'repo', 'uncommitted');
      const risk = await createAnalysis(review.id, 'risk');
      const narrative = await createAnalysis(review.id, 'narrative');

      const latestRisk = await getLatestAnalysis(review.id, 'risk');
      const latestNarrative = await getLatestAnalysis(review.id, 'narrative');

      expect(latestRisk!.id).toBe(risk.id);
      expect(latestNarrative!.id).toBe(narrative.id);
    });
  });

  // --- AI File Scores ---

  describe('AI File Scores', () => {
    function makeScore(filePath: string, sortOrder: number, aggregateScore: number | null = null) {
      return {
        reviewFileId: 'rf-' + filePath,
        filePath,
        sortOrder,
        aggregateScore,
        rationale: `rationale for ${filePath}`,
        dimensionScores: aggregateScore !== null ? { complexity: aggregateScore, risk: aggregateScore } : null,
        notes: null,
      };
    }

    it('saveFileScores inserts scores', async () => {
      const review = await createReview('/repo/scores', 'repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      await saveFileScores(analysis.id, [
        makeScore('a.ts', 0, 0.8),
        makeScore('b.ts', 1, 0.5),
      ]);

      const scores = await getFileScores(analysis.id);
      expect(scores.length).toBe(2);
      expect(scores[0].file_path).toBe('a.ts');
      expect(scores[0].sort_order).toBe(0);
      expect(scores[0].aggregate_score).toBeCloseTo(0.8);
      expect(scores[0].rationale).toBe('rationale for a.ts');
      expect(scores[1].file_path).toBe('b.ts');
    });

    it('saveFileScores replaces previous scores (deletes first)', async () => {
      const review = await createReview('/repo/scores-replace', 'repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      await saveFileScores(analysis.id, [
        makeScore('old.ts', 0, 0.9),
      ]);
      expect((await getFileScores(analysis.id)).length).toBe(1);

      await saveFileScores(analysis.id, [
        makeScore('new-a.ts', 0, 0.7),
        makeScore('new-b.ts', 1, 0.3),
      ]);

      const scores = await getFileScores(analysis.id);
      expect(scores.length).toBe(2);
      expect(scores[0].file_path).toBe('new-a.ts');
      expect(scores[1].file_path).toBe('new-b.ts');
    });

    it('appendFileScores skips duplicates', async () => {
      const review = await createReview('/repo/scores-append', 'repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      await saveFileScores(analysis.id, [
        makeScore('existing.ts', 0, 0.5),
      ]);

      await appendFileScores(analysis.id, [
        makeScore('existing.ts', 0, 0.9),  // duplicate - should be skipped
        makeScore('new-file.ts', 1, 0.7),  // new - should be added
      ]);

      const scores = await getFileScores(analysis.id);
      expect(scores.length).toBe(2);
      // existing.ts should keep original score
      const existing = scores.find(s => s.file_path === 'existing.ts')!;
      expect(existing.aggregate_score).toBeCloseTo(0.5);
      // new-file.ts should be added
      const newFile = scores.find(s => s.file_path === 'new-file.ts');
      expect(newFile).toBeDefined();
      expect(newFile!.aggregate_score).toBeCloseTo(0.7);
    });

    it('getFileScores ordered by sort_order', async () => {
      const review = await createReview('/repo/scores-order', 'repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      await saveFileScores(analysis.id, [
        makeScore('z.ts', 2, 0.1),
        makeScore('a.ts', 0, 0.9),
        makeScore('m.ts', 1, 0.5),
      ]);

      const scores = await getFileScores(analysis.id);
      expect(scores.length).toBe(3);
      expect(scores[0].file_path).toBe('a.ts');
      expect(scores[0].sort_order).toBe(0);
      expect(scores[1].file_path).toBe('m.ts');
      expect(scores[1].sort_order).toBe(1);
      expect(scores[2].file_path).toBe('z.ts');
      expect(scores[2].sort_order).toBe(2);
    });

    it('saveFileScores stores dimension_scores as JSON', async () => {
      const review = await createReview('/repo/scores-json', 'repo', 'uncommitted');
      const analysis = await createAnalysis(review.id, 'risk');

      await saveFileScores(analysis.id, [{
        reviewFileId: 'rf-1',
        filePath: 'test.ts',
        sortOrder: 0,
        aggregateScore: 0.75,
        rationale: 'test',
        dimensionScores: { complexity: 0.8, risk: 0.7 },
        notes: { overview: 'some notes', lines: [{ line: 10, content: 'important' }] },
      }]);

      const scores = await getFileScores(analysis.id);
      expect(scores.length).toBe(1);
      const dims = JSON.parse(scores[0].dimension_scores!);
      expect(dims.complexity).toBe(0.8);
      expect(dims.risk).toBe(0.7);
      const notes = JSON.parse(scores[0].notes!);
      expect(notes.overview).toBe('some notes');
      expect(notes.lines[0].line).toBe(10);
    });

    it('getFileScoresForReview returns scores from latest completed/running analysis', async () => {
      const review = await createReview('/repo/scores-review', 'repo', 'uncommitted');
      const file = await addReviewFile(review.id, 'test.ts', '{}');

      // Create first analysis (completed)
      const a1 = await createAnalysis(review.id, 'risk');
      await saveFileScores(a1.id, [
        { reviewFileId: file.id, filePath: 'test.ts', sortOrder: 0, aggregateScore: 0.5, rationale: 'old', dimensionScores: null, notes: null },
      ]);
      await updateAnalysisStatus(a1.id, 'completed');

      // Create second analysis (also completed) - should be the one returned
      const a2 = await createAnalysis(review.id, 'risk');
      await saveFileScores(a2.id, [
        { reviewFileId: file.id, filePath: 'test.ts', sortOrder: 0, aggregateScore: 0.9, rationale: 'new', dimensionScores: null, notes: null },
      ]);
      await updateAnalysisStatus(a2.id, 'completed');

      const scores = await getFileScoresForReview(review.id, 'risk');
      expect(scores.length).toBe(1);
      expect(scores[0].aggregate_score).toBeCloseTo(0.9);
    });

    it('getPreviousScores excludes the specified analysis', async () => {
      const review = await createReview('/repo/prev-scores', 'repo', 'uncommitted');

      const a1 = await createAnalysis(review.id, 'risk');
      await saveFileScores(a1.id, [
        makeScore('old.ts', 0, 0.3),
      ]);
      await updateAnalysisStatus(a1.id, 'completed');

      const a2 = await createAnalysis(review.id, 'risk');

      const prev = await getPreviousScores(review.id, 'risk', a2.id);
      expect(prev.length).toBe(1);
      expect(prev[0].file_path).toBe('old.ts');
      expect(prev[0].analysis_id).toBe(a1.id);
    });

    it('getPreviousScores falls back to failed analysis', async () => {
      const review = await createReview('/repo/prev-failed', 'repo', 'uncommitted');

      const a1 = await createAnalysis(review.id, 'narrative');
      await saveFileScores(a1.id, [
        makeScore('partial.ts', 0, 0.4),
      ]);
      await updateAnalysisStatus(a1.id, 'failed', 'interrupted');

      const a2 = await createAnalysis(review.id, 'narrative');

      const prev = await getPreviousScores(review.id, 'narrative', a2.id);
      expect(prev.length).toBe(1);
      expect(prev[0].file_path).toBe('partial.ts');
    });

    it('getPreviousScores returns empty when no previous analyses', async () => {
      const review = await createReview('/repo/prev-none', 'repo', 'uncommitted');
      const a1 = await createAnalysis(review.id, 'risk');

      const prev = await getPreviousScores(review.id, 'risk', a1.id);
      expect(prev.length).toBe(0);
    });
  });

  // --- User Preferences ---

  describe('User Preferences', () => {
    it('getUserPreferences returns defaults when no record', async () => {
      const prefs = await getUserPreferences();
      expect(prefs.sort_mode).toBe('folder');
      expect(prefs.risk_sort_dimension).toBe('aggregate');
      expect(prefs.show_risk_scores).toBe(false);
      // Side-by-side is the default image-comparison mode, left-right its default
      // orientation (doc 24).
      expect(prefs.last_image_mode).toBe('side-by-side');
      expect(prefs.image_sxs_orientation).toBe('left-right');
    });

    it('saveUserPreferences round-trips the side-by-side orientation', async () => {
      await saveUserPreferences({ image_sxs_orientation: 'over-under' });
      const prefs = await getUserPreferences();
      expect(prefs.image_sxs_orientation).toBe('over-under');
      // Kept across an unrelated update.
      await saveUserPreferences({ sort_mode: 'folder' });
      expect((await getUserPreferences()).image_sxs_orientation).toBe('over-under');
    });

    it('saveUserPreferences creates record', async () => {
      await saveUserPreferences({ sort_mode: 'risk' });
      const prefs = await getUserPreferences();
      expect(prefs.sort_mode).toBe('risk');
      // Other fields should keep defaults
      expect(prefs.risk_sort_dimension).toBe('aggregate');
      expect(prefs.show_risk_scores).toBe(false);
    });

    it('saveUserPreferences updates existing', async () => {
      await saveUserPreferences({ sort_mode: 'narrative', show_risk_scores: true });
      const prefs = await getUserPreferences();
      expect(prefs.sort_mode).toBe('narrative');
      expect(prefs.show_risk_scores).toBe(true);

      // Update again with partial
      await saveUserPreferences({ risk_sort_dimension: 'complexity' });
      const prefs2 = await getUserPreferences();
      expect(prefs2.sort_mode).toBe('narrative'); // kept from previous
      expect(prefs2.risk_sort_dimension).toBe('complexity');
      expect(prefs2.show_risk_scores).toBe(true); // kept from previous
    });
  });
});
