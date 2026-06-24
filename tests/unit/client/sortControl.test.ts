import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', '..', 'src', 'client', 'sidebar', 'sortControl.tsx');

/**
 * GB-991 regression guard for the default-active mapping of the sort-mode
 * segmented control.
 *
 * The e2e suite can't reliably assert "folder active by default" because the
 * shared demo server persists `sort_mode` across specs (a prior spec switching
 * to risk/narrative leaves it persisted, so the next page load hydrates that
 * mode). The deterministic mapping — each `data-sort-mode` button gets the
 * `active` class iff `ai.sortMode` equals that mode — is locked in here at the
 * source level (the store needs a DOM, which the node test env doesn't provide,
 * so this follows the source-inspection precedent of other client tests).
 */
describe('GB-991: sort-control active-segment mapping', () => {
  const src = readFileSync(SRC, 'utf-8');

  for (const mode of ['folder', 'risk', 'narrative'] as const) {
    it(`ties the ${mode} segment's active class to sortMode === '${mode}'`, () => {
      // Each button reads: className={`segment sort-segment${ai.sortMode === 'X' ? ' active' : ''}`}
      // immediately followed by data-sort-mode="X". Assert the conditional names
      // the matching mode (not a hard-coded or mismatched one).
      const re = new RegExp(
        `ai\\.sortMode === '${mode}' \\? ' active' : ''\}\`[\\s\\S]{0,40}data-sort-mode="${mode}"`,
      );
      expect(src).toMatch(re);
    });
  }

  it('does not hard-code the active class onto any segment', () => {
    // A literal " active" not guarded by a sortMode comparison would re-introduce
    // a permanently-highlighted segment.
    expect(src).not.toMatch(/sort-segment active`/);
  });
});
