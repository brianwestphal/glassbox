/**
 * Pure selection math for plugin segmented-controls (doc 30 FR-30.3).
 */
import { describe, expect, it } from 'vitest';

import { asSelectionMode, encodeSelection, nextSelection, parseSelection } from '../../../src/client/plugins/segmentSelection.js';

describe('asSelectionMode', () => {
  it('passes through known modes, defaults unknown to exactly-one', () => {
    expect(asSelectionMode('zero-or-more')).toBe('zero-or-more');
    expect(asSelectionMode('bogus')).toBe('exactly-one');
    expect(asSelectionMode(undefined)).toBe('exactly-one');
  });
});

describe('parseSelection', () => {
  it('parses a JSON array (multi)', () => {
    expect(parseSelection('["a","b"]')).toEqual(['a', 'b']);
  });
  it('treats a bare id as a single selection', () => {
    expect(parseSelection('a')).toEqual(['a']);
  });
  it('empty / undefined -> []', () => {
    expect(parseSelection('')).toEqual([]);
    expect(parseSelection(undefined)).toEqual([]);
  });
  it('drops non-string array entries', () => {
    expect(parseSelection('["a",1,null,"b"]')).toEqual(['a', 'b']);
  });
});

describe('nextSelection', () => {
  it('exactly-one: always the clicked segment (no deselect)', () => {
    expect(nextSelection('exactly-one', ['a'], 'a')).toEqual(['a']);
    expect(nextSelection('exactly-one', ['a'], 'b')).toEqual(['b']);
  });
  it('zero-or-one: clicking the selected one clears it', () => {
    expect(nextSelection('zero-or-one', ['a'], 'a')).toEqual([]);
    expect(nextSelection('zero-or-one', [], 'a')).toEqual(['a']);
    expect(nextSelection('zero-or-one', ['a'], 'b')).toEqual(['b']);
  });
  it('zero-or-more: toggles membership', () => {
    expect(nextSelection('zero-or-more', ['a'], 'b')).toEqual(['a', 'b']);
    expect(nextSelection('zero-or-more', ['a', 'b'], 'a')).toEqual(['b']);
    expect(nextSelection('zero-or-more', ['a'], 'a')).toEqual([]);
  });
  it('one-or-more: toggles but never drops below one', () => {
    expect(nextSelection('one-or-more', ['a', 'b'], 'a')).toEqual(['b']);
    expect(nextSelection('one-or-more', ['a'], 'a')).toEqual(['a']); // can't deselect the last
    expect(nextSelection('one-or-more', ['a'], 'b')).toEqual(['a', 'b']);
  });
});

describe('encodeSelection', () => {
  it('single modes -> bare id (or empty)', () => {
    expect(encodeSelection('exactly-one', ['a'])).toBe('a');
    expect(encodeSelection('zero-or-one', [])).toBe('');
  });
  it('multi modes -> JSON array', () => {
    expect(encodeSelection('zero-or-more', ['a', 'b'])).toBe('["a","b"]');
    expect(encodeSelection('one-or-more', ['a'])).toBe('["a"]');
  });
  it('round-trips through parseSelection', () => {
    for (const sel of [['a'], ['a', 'b'], []]) {
      expect(parseSelection(encodeSelection('zero-or-more', sel))).toEqual(sel);
    }
  });
});
