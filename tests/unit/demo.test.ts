import { DEMO_SCENARIOS } from '../../src/demo.js';

// Mock all database and config modules
vi.mock('../../src/db/queries.js', () => ({
  createReview: vi.fn().mockResolvedValue({ id: 'r-demo' }),
  addReviewFile: vi.fn().mockImplementation((_rid, path) =>
    Promise.resolve({ id: `f-${path}`, review_id: 'r-demo', file_path: path, status: 'pending', diff_data: null })),
  addAnnotation: vi.fn().mockResolvedValue({}),
  updateFileStatus: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/db/ai-queries.js', () => ({
  createAnalysis: vi.fn().mockResolvedValue({ id: 'a-demo' }),
  appendFileScores: vi.fn().mockResolvedValue(undefined),
  updateAnalysisStatus: vi.fn().mockResolvedValue(undefined),
  saveUserPreferences: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/ai/config.js', () => ({
  saveGuidedReviewConfig: vi.fn(),
}));

import { createReview, addReviewFile, addAnnotation } from '../../src/db/queries.js';
import { createAnalysis, saveUserPreferences } from '../../src/db/ai-queries.js';
import { saveGuidedReviewConfig } from '../../src/ai/config.js';
import { setupDemoReview } from '../../src/demo.js';

describe('DEMO_SCENARIOS', () => {
  it('has 6 scenarios with unique ids', () => {
    expect(DEMO_SCENARIOS).toHaveLength(6);
    const ids = DEMO_SCENARIOS.map(s => s.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('each scenario has id and label', () => {
    for (const s of DEMO_SCENARIOS) {
      expect(typeof s.id).toBe('number');
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

describe('setupDemoReview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a review and returns its id', async () => {
    const result = await setupDemoReview(1);
    expect(result).toEqual({ reviewId: 'r-demo' });
    expect(createReview).toHaveBeenCalledWith(
      expect.any(String), 'demo-project', 'demo', 'scenario-1',
    );
  });

  it('adds demo files to the review', async () => {
    await setupDemoReview(1);
    expect(addReviewFile).toHaveBeenCalled();
    const calls = vi.mocked(addReviewFile).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(4);
    // Each call passes review id and file path
    for (const call of calls) {
      expect(call[0]).toBe('r-demo');
      expect(typeof call[1]).toBe('string');
    }
  });

  it('scenario 1 sets up guided review notes', async () => {
    await setupDemoReview(1);
    expect(createAnalysis).toHaveBeenCalledWith('r-demo', 'guided');
    expect(saveGuidedReviewConfig).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('scenario 2 sets up risk scores', async () => {
    await setupDemoReview(2);
    expect(createAnalysis).toHaveBeenCalledWith('r-demo', 'risk');
    expect(saveUserPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ sort_mode: 'risk', show_risk_scores: true }),
    );
  });

  it('scenario 3 sets up narrative order', async () => {
    await setupDemoReview(3);
    expect(createAnalysis).toHaveBeenCalledWith('r-demo', 'narrative');
    expect(saveUserPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ sort_mode: 'narrative' }),
    );
  });

  it('scenario 4 sets up annotations', async () => {
    await setupDemoReview(4);
    expect(addAnnotation).toHaveBeenCalled();
  });

  it('scenario 5 enables guided review settings', async () => {
    await setupDemoReview(5);
    expect(saveGuidedReviewConfig).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, topics: expect.arrayContaining(['programming']) }),
    );
  });
});
