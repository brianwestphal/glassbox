import { buildGuidedReviewSuffix, TOP_LANGUAGES, MORE_LANGUAGES } from '../../../src/ai/guided-review.js';

describe('buildGuidedReviewSuffix', () => {
  it('returns empty string when disabled', () => {
    const result = buildGuidedReviewSuffix({ enabled: false, topics: ['typescript'] }, 'risk');
    expect(result).toBe('');
  });

  it('returns empty string when no topics', () => {
    const result = buildGuidedReviewSuffix({ enabled: true, topics: [] }, 'risk');
    expect(result).toBe('');
  });

  it('includes topic names in output', () => {
    const result = buildGuidedReviewSuffix({ enabled: true, topics: ['typescript', 'rust'] }, 'risk');
    expect(result).toContain('TypeScript');
    expect(result).toContain('Rust');
  });

  it('includes guided review header', () => {
    const result = buildGuidedReviewSuffix({ enabled: true, topics: ['programming'] }, 'risk');
    expect(result).toContain('GUIDED REVIEW MODE');
    expect(result).toContain('programming in general');
  });

  it('includes risk-specific instructions for risk analysis type', () => {
    const result = buildGuidedReviewSuffix({ enabled: true, topics: ['javascript'] }, 'risk');
    expect(result).toContain('rationale');
    expect(result).toContain('line-level notes');
    expect(result).toContain('code examples');
  });

  it('includes narrative-specific instructions for narrative analysis type', () => {
    const result = buildGuidedReviewSuffix({ enabled: true, topics: ['javascript'] }, 'narrative');
    expect(result).toContain('overview notes');
    expect(result).toContain('reading order');
    expect(result).toContain('patterns, conventions');
  });

  it('falls back to topic key when display name not found', () => {
    const result = buildGuidedReviewSuffix({ enabled: true, topics: ['unknown-topic'] }, 'risk');
    expect(result).toContain('unknown-topic');
  });
});

describe('language lists', () => {
  it('TOP_LANGUAGES has 10 entries', () => {
    expect(TOP_LANGUAGES).toHaveLength(10);
  });

  it('MORE_LANGUAGES has entries', () => {
    expect(MORE_LANGUAGES.length).toBeGreaterThan(0);
  });

  it('all language entries are [key, displayName] tuples', () => {
    for (const [key, name] of [...TOP_LANGUAGES, ...MORE_LANGUAGES]) {
      expect(typeof key).toBe('string');
      expect(typeof name).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('no overlap between TOP and MORE', () => {
    const topKeys = new Set(TOP_LANGUAGES.map(([k]) => k));
    for (const [key] of MORE_LANGUAGES) {
      expect(topKeys.has(key)).toBe(false);
    }
  });
});
