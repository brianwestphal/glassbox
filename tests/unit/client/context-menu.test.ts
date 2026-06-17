/**
 * GB-884 / GB-891 — right-click a sidebar file row to act on it (reveal, copy
 * path, mark reviewed/pending, open in editor).
 *
 * The DOM interaction (menu open / dismiss / dispatch) is covered by the e2e
 * suite (`tests/e2e/sidebar.test.ts`); these unit tests pin the pure label
 * helpers, which must match what each action actually does — the reveal label
 * tracks the OS file manager, the copy label tracks the Option/Alt modifier,
 * and the mark label tracks the file's current status.
 */
import { describe, expect, it } from 'vitest';

import { copyPathLabel, markStatusLabel, revealLabel } from '../../../src/client/sidebar/contextMenuLabels.js';

describe('revealLabel (GB-884)', () => {
  it('says "Reveal in Finder" on macOS', () => {
    expect(revealLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Reveal in Finder');
  });

  it('says "Reveal in File Explorer" on Windows', () => {
    expect(revealLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Reveal in File Explorer');
  });

  it('says "Open Containing Folder" on Linux (no select equivalent)', () => {
    expect(revealLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Open Containing Folder');
  });

  it('falls back to "Open Containing Folder" for an unrecognized platform', () => {
    expect(revealLabel('some-unknown-agent')).toBe('Open Containing Folder');
  });
});

describe('copyPathLabel (GB-891)', () => {
  it('copies the absolute path by default', () => {
    expect(copyPathLabel(false)).toBe('Copy Absolute Path');
  });

  it('copies the relative path when Option/Alt is held', () => {
    expect(copyPathLabel(true)).toBe('Copy Relative Path');
  });
});

describe('markStatusLabel (GB-891)', () => {
  it('offers "Mark as Pending" for a reviewed file', () => {
    expect(markStatusLabel('reviewed')).toBe('Mark as Pending');
  });

  it('offers "Mark as Reviewed" for a pending file', () => {
    expect(markStatusLabel('pending')).toBe('Mark as Reviewed');
  });

  it('offers "Mark as Reviewed" when status is unknown', () => {
    expect(markStatusLabel(undefined)).toBe('Mark as Reviewed');
  });
});
