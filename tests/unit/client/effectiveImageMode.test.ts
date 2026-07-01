/**
 * Doc 24 FR-24.2 — the stored image-comparison mode must resolve to one that
 * actually exists for the current file. `effectiveImageMode` reads the diff
 * element's `hasOld`/`hasNew` dataset flags:
 *   - a two-sided file (both flags 'true') maps the single "image" mode to the
 *     Side by Side default, and passes the comparison modes through unchanged;
 *   - a single-side file (added/deleted — only one flag) has no comparison
 *     panels, so every comparison-only mode (side-by-side / difference / slice /
 *     A / B) falls back to the single "image" viewer.
 */
import { describe, expect, it } from 'vitest';

// The diff module pulls in the client stores, which read
// `document.body.dataset` at import time; this repo ships no jsdom, so seed a
// minimal document/window before importing (default node vitest environment).
const g = globalThis as unknown as { document?: unknown; window?: unknown };
g.document = { body: { dataset: {} } };
g.window = { location: { search: '' } };

const { effectiveImageMode } = await import('../../../src/client/diff/index.js');

function fakeEl(dataset: Record<string, string>): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

describe('effectiveImageMode (doc 24 FR-24.2)', () => {
  describe('two-sided element (hasOld + hasNew)', () => {
    const el = fakeEl({ hasOld: 'true', hasNew: 'true' });

    it('maps the single "image" mode to the Side by Side default', () => {
      expect(effectiveImageMode(el, 'image')).toBe('side-by-side');
    });

    it('passes comparison / focus modes through unchanged', () => {
      for (const mode of ['side-by-side', 'difference', 'a', 'b']) {
        expect(effectiveImageMode(el, mode)).toBe(mode);
      }
    });
  });

  describe('single-side element (hasOld only)', () => {
    const el = fakeEl({ hasOld: 'true' });

    it('falls back every comparison-only mode to "image"', () => {
      for (const mode of ['side-by-side', 'difference', 'slice', 'a', 'b']) {
        expect(effectiveImageMode(el, mode)).toBe('image');
      }
    });

    it('leaves "image" as "image"', () => {
      expect(effectiveImageMode(el, 'image')).toBe('image');
    });

    it('treats an explicit hasNew="false" the same as absent', () => {
      const explicit = fakeEl({ hasOld: 'true', hasNew: 'false' });
      expect(effectiveImageMode(explicit, 'side-by-side')).toBe('image');
      expect(effectiveImageMode(explicit, 'image')).toBe('image');
    });
  });
});
