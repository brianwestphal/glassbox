/**
 * Transition tests for the navigation stack (src/client/diff/navStack.ts) —
 * the browser-like back/forward history behind go-to-definition and file
 * switching. The module keeps its stack in module scope, so each test imports
 * a fresh copy via vi.resetModules().
 *
 * Runs under the default node environment: the module's button-state sync
 * looks up `#nav-back-btn` / `#nav-forward-btn` and no-ops when absent, so a
 * minimal `document` stub is enough.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal DOM surface: updateButtons() and getVisibleScrollLine() both look
// elements up by id and tolerate null.
vi.stubGlobal('document', {
  body: { dataset: {} },
  getElementById: () => null,
});

type NavStack = typeof import('../../../src/client/diff/navStack.js');

let nav: NavStack;

beforeEach(async () => {
  vi.resetModules();
  nav = await import('../../../src/client/diff/navStack.js');
});

/** Review-file entry (fileId set, no raw path). */
function file(id: string, scrollLine = 1) {
  return { fileId: id, filePath: null, scrollLine };
}

/** Raw repo file opened via go-to-definition (no review file id). */
function raw(path: string, scrollLine = 1) {
  return { fileId: null, filePath: path, scrollLine };
}

describe('navStack transitions', () => {
  it('A→B→C→back→back→push-D truncates the forward stack', () => {
    nav.navPush(file('A'));
    nav.navPush(file('B'));
    nav.navPush(file('C'));

    expect(nav.navBack()).toMatchObject({ fileId: 'B' });
    expect(nav.navBack()).toMatchObject({ fileId: 'A' });
    expect(nav.canGoForward()).toBe(true);

    // Clicking a new file from the middle of history clears B and C.
    nav.navPush(file('D'));
    expect(nav.canGoForward()).toBe(false);
    expect(nav.navForward()).toBeNull();
    // Back now returns A (D's predecessor), not B.
    expect(nav.navBack()).toMatchObject({ fileId: 'A' });
    expect(nav.navForward()).toMatchObject({ fileId: 'D' });
  });

  it('re-pushing the current file coalesces (updates scroll, no new entry)', () => {
    nav.navPush(file('A', 1));
    nav.navPush(file('A', 42));

    expect(nav.canGoBack()).toBe(false);
    // The single entry carries the newest scroll position.
    nav.navPush(file('B'));
    expect(nav.navBack()).toMatchObject({ fileId: 'A', scrollLine: 42 });
  });

  it('rapid back/forward alternation stays within bounds and is lossless', () => {
    nav.navPush(file('A'));
    nav.navPush(file('B'));
    nav.navPush(file('C'));

    for (let i = 0; i < 5; i++) {
      expect(nav.navBack()).toMatchObject({ fileId: 'B' });
      expect(nav.navForward()).toMatchObject({ fileId: 'C' });
    }
    // Walk fully back, then fully forward — both ends clamp with null.
    expect(nav.navBack()).toMatchObject({ fileId: 'B' });
    expect(nav.navBack()).toMatchObject({ fileId: 'A' });
    expect(nav.navBack()).toBeNull();
    expect(nav.canGoBack()).toBe(false);
    expect(nav.navForward()).toMatchObject({ fileId: 'B' });
    expect(nav.navForward()).toMatchObject({ fileId: 'C' });
    expect(nav.navForward()).toBeNull();
    expect(nav.canGoForward()).toBe(false);
  });

  it('back on an empty or single-entry stack returns null', () => {
    expect(nav.navBack()).toBeNull();
    expect(nav.navForward()).toBeNull();
    nav.navPush(file('A'));
    expect(nav.navBack()).toBeNull();
    expect(nav.canGoBack()).toBe(false);
  });

  it('mixes review-file and raw-file entries without cross-coalescing', () => {
    nav.navPush(file('A'));
    nav.navPush(raw('/repo/src/util.ts'));
    nav.navPush(file('B'));

    expect(nav.navBack()).toMatchObject({ fileId: null, filePath: '/repo/src/util.ts' });
    expect(nav.navBack()).toMatchObject({ fileId: 'A', filePath: null });
    expect(nav.navForward()).toMatchObject({ filePath: '/repo/src/util.ts' });
    expect(nav.navForward()).toMatchObject({ fileId: 'B' });
  });

  it('coalesces raw-file entries by path', () => {
    nav.navPush(raw('/repo/a.ts', 1));
    nav.navPush(raw('/repo/a.ts', 30));
    expect(nav.canGoBack()).toBe(false);
    nav.navPush(raw('/repo/b.ts'));
    expect(nav.navBack()).toMatchObject({ filePath: '/repo/a.ts', scrollLine: 30 });
  });

  it('a review-file entry and a raw entry never coalesce even at the same scroll', () => {
    // isSameFile requires BOTH sides to have a fileId (or both a filePath) —
    // a review file followed by a raw file is always a new entry.
    nav.navPush(file('A'));
    nav.navPush(raw('/repo/A'));
    expect(nav.canGoBack()).toBe(true);
  });

  it('navPush during back/forward navigation is suppressed by the navigating flag', () => {
    nav.navPush(file('A'));
    nav.navPush(file('B'));
    nav.navBack();

    // selectFile() re-fires navPush while navigating — must not truncate or push.
    nav.setNavigating(true);
    nav.navPush(file('A'));
    nav.setNavigating(false);

    expect(nav.canGoForward()).toBe(true);
    expect(nav.navForward()).toMatchObject({ fileId: 'B' });
  });

  it('navUpdateScroll mutates the current entry only', () => {
    nav.navPush(file('A', 1));
    nav.navPush(file('B', 1));
    nav.navUpdateScroll(99);

    expect(nav.navBack()).toMatchObject({ fileId: 'A', scrollLine: 1 });
    expect(nav.navForward()).toMatchObject({ fileId: 'B', scrollLine: 99 });
  });

  it('returned entries are copies — mutating them does not corrupt the stack', () => {
    nav.navPush(file('A', 5));
    nav.navPush(file('B'));
    const back = nav.navBack();
    if (back === null) throw new Error('expected entry');
    back.scrollLine = 1234;
    nav.navForward();
    expect(nav.navBack()).toMatchObject({ fileId: 'A', scrollLine: 5 });
  });
});
