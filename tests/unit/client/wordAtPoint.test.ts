import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWordAtPoint } from '../../../src/client/diff/wordAtPoint.js';

// Model the browser's caret and Range text for a code cell split by highlights.
function pointAt(parts: string[], part: number, offset: number, inCode = true) {
  const text = parts.join('');
  const code = { textContent: text };
  const nodes = parts.map(textContent => ({
    nodeType: 3,
    textContent,
    parentElement: { closest: () => inCode ? code : null },
  }));
  vi.stubGlobal('Node', { TEXT_NODE: 3 });
  vi.stubGlobal('document', {
    caretRangeFromPoint: () => ({ startContainer: nodes[part], startOffset: offset }),
    createRange: () => {
      let end = 0;
      return {
        selectNodeContents: (element: unknown) => { expect(element).toBe(code); },
        setEnd: (node: typeof nodes[number], localOffset: number) => {
          end = parts.slice(0, nodes.indexOf(node)).join('').length + localOffset;
        },
        toString: () => text.slice(0, end),
      };
    },
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('getWordAtPoint', () => {
  it.each([
    ['highlighted prefix', 1, 3],
    ['unhighlighted suffix', 2, 3],
    ['end of highlighted prefix', 1, 7],
    ['start of unhighlighted suffix', 2, 0],
  ])('reads the complete identifier from the %s', (_name, part, offset) => {
    pointAt(['await ', 'createS', 'ession', '(user);'], part, offset);
    expect(getWordAtPoint(10, 20)).toBe('createSession');
  });

  it.each([0, 1, 2])('joins multiple highlight fragments when clicking part %i', part => {
    pointAt(['create', 'Sess', 'ion', '()'], part, 2);
    expect(getWordAtPoint(10, 20)).toBe('createSession');
  });

  it('stops at punctuation between neighboring identifiers', () => {
    pointAt(['store.', 'create', 'Session', '(user)'], 2, 3);
    expect(getWordAtPoint(10, 20)).toBe('createSession');
  });

  it('handles code without highlight spans and preserves dollar/underscore identifiers', () => {
    pointAt(['$create_session42();'], 0, 8);
    expect(getWordAtPoint(10, 20)).toBe('$create_session42');
  });

  it.each([
    [['ret', 'urn', ' value'], 1, 1],
    [['12', '34', ';'], 1, 1],
    [['a;'], 0, 0],
    [['   '], 0, 1],
    [[''], 0, 0],
    [['createSession'], 0, 13],
  ] as const)('ignores keywords, numbers, short/empty words and end-of-line carets (%j)', (parts, part, offset) => {
    pointAt([...parts], part, offset);
    expect(getWordAtPoint(10, 20)).toBeNull();
  });

  it('ignores text outside a code cell', () => {
    pointAt(['createSession'], 0, 4, false);
    expect(getWordAtPoint(10, 20)).toBeNull();
  });

  it('ignores missing carets and element nodes', () => {
    vi.stubGlobal('Node', { TEXT_NODE: 3 });
    const hit = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce({
      startContainer: { nodeType: 1 }, startOffset: 0,
    });
    vi.stubGlobal('document', { caretRangeFromPoint: hit });
    expect(getWordAtPoint(10, 20)).toBeNull();
    expect(getWordAtPoint(10, 20)).toBeNull();
  });
});
