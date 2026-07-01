/**
 * Doc 5.2 — annotation categories. Pins the documented category set: the seven
 * categories (bug, fix, style, pattern-follow, pattern-avoid, note, remember)
 * must be present, in source order, each with a non-empty label, no duplicates.
 * These drive the category picker and the exported markdown, so an accidental
 * add/remove/rename here is a requirements-level change.
 */
import { describe, expect, it } from 'vitest';

import { CATEGORIES } from '../../../src/client/state.js';

const DOCUMENTED_VALUES = [
  'bug',
  'fix',
  'style',
  'pattern-follow',
  'pattern-avoid',
  'note',
  'remember',
] as const;

describe('CATEGORIES (doc 5.2)', () => {
  it('contains exactly the seven documented category values, in source order', () => {
    expect(CATEGORIES.map((c) => c.value)).toEqual([...DOCUMENTED_VALUES]);
  });

  it('gives every category a non-empty label', () => {
    for (const category of CATEGORIES) {
      expect(typeof category.label).toBe('string');
      expect(category.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate category values', () => {
    const values = CATEGORIES.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
