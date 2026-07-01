/**
 * Doc 16.3 — the share action. `triggerShare()` uses the Web Share API when
 * available (so the OS share sheet carries the npm package URL), and otherwise
 * falls back to copying the URL to the clipboard and surfacing a `.share-toast`
 * confirmation.
 *
 * The suite runs under the default node vitest environment (this repo ships no
 * jsdom/happy-dom), so `navigator` is stubbed via `vi.stubGlobal`, a minimal
 * fake `document` backs the toast path, and `./dom.js`'s `toElement` is mocked
 * to a lightweight fake element (kerf's real `toElement` needs a live DOM).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const SHARE_URL = 'https://www.npmjs.com/package/glassbox';

interface FakeEl {
  className: string;
  remove: () => void;
}

// kerf's toElement needs a real DOM; substitute a fake element that records the
// class name it was asked to build so the fake document can match it.
vi.mock('../../../src/client/dom.js', () => ({
  toElement: (jsx: unknown) => {
    const html = String(jsx);
    const match = /class(?:Name)?="([^"]*)"/.exec(html);
    const el: FakeEl = { className: match ? match[1] : '', remove() {} };
    el.remove = () => removeFromBody(el);
    return el;
  },
}));

const bodyChildren: FakeEl[] = [];
function removeFromBody(el: FakeEl): void {
  const i = bodyChildren.indexOf(el);
  if (i !== -1) bodyChildren.splice(i, 1);
}

function installFakeDocument(): void {
  const doc = {
    body: {
      appendChild(node: FakeEl) {
        bodyChildren.push(node);
        return node;
      },
    },
    querySelector(selector: string) {
      const cls = selector.startsWith('.') ? selector.slice(1) : selector;
      return bodyChildren.find((c) => c.className.split(/\s+/).includes(cls)) ?? null;
    },
  };
  vi.stubGlobal('document', doc);
}

const { triggerShare } = await import('../../../src/client/share.js');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  bodyChildren.length = 0;
});

describe('triggerShare (doc 16.3)', () => {
  it('uses the Web Share API with the npm URL and does not touch the clipboard', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: shareSpy, clipboard: { writeText: writeTextSpy } });

    await triggerShare();

    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy.mock.calls[0][0]).toMatchObject({ url: SHARE_URL });
    expect(writeTextSpy).not.toHaveBeenCalled();
  });

  it('falls back to clipboard copy and shows a .share-toast when Web Share is unavailable', async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    // No `share` on navigator → the fallback branch.
    vi.stubGlobal('navigator', { clipboard: { writeText: writeTextSpy } });
    installFakeDocument();

    await triggerShare();

    expect(writeTextSpy).toHaveBeenCalledTimes(1);
    expect(writeTextSpy).toHaveBeenCalledWith(SHARE_URL);
    expect(document.querySelector('.share-toast')).not.toBeNull();
  });
});
