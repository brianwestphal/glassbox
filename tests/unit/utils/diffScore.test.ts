import { describe, expect, it } from 'vitest';

import { diffScoreLevel, formatDiffPct } from '../../../src/utils/diffScore.js';

// doc 26 P2 — formatting the perceptual difference score.
describe('formatDiffPct', () => {
  it('shows 0% for an identical pair', () => {
    expect(formatDiffPct(0)).toBe('0%');
  });

  it('keeps a decimal for sub-1% so a small change does not round away', () => {
    expect(formatDiffPct(0.003)).toBe('0.3%');
    expect(formatDiffPct(0.009)).toBe('0.9%');
  });

  it('rounds to a whole percent at or above 1%', () => {
    expect(formatDiffPct(0.25)).toBe('25%');
    expect(formatDiffPct(0.014)).toBe('1%');
    expect(formatDiffPct(1)).toBe('100%');
  });
});

describe('diffScoreLevel', () => {
  it('buckets scores into severity tiers', () => {
    expect(diffScoreLevel(0)).toBe('none');
    expect(diffScoreLevel(0.01)).toBe('low');
    expect(diffScoreLevel(0.05)).toBe('medium');
    expect(diffScoreLevel(0.5)).toBe('high');
  });
});
