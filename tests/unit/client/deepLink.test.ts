import { describe, expect, it } from 'vitest';

import { parseDeepLink } from '../../../src/client/diff/deepLink.js';

describe('parseDeepLink (doc 34)', () => {
  it('returns null when there is no file param', () => {
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('?line=5')).toBeNull();
    expect(parseDeepLink('?file=')).toBeNull();
    expect(parseDeepLink('?other=1&thing=2')).toBeNull();
  });

  it('parses a file + line', () => {
    expect(parseDeepLink('?file=src/a.ts&line=42')).toEqual({ file: 'src/a.ts', line: 42 });
  });

  it('defaults line to 1 when missing, non-numeric, or non-positive', () => {
    expect(parseDeepLink('?file=x')).toEqual({ file: 'x', line: 1 });
    expect(parseDeepLink('?file=x&line=abc')).toEqual({ file: 'x', line: 1 });
    expect(parseDeepLink('?file=x&line=0')).toEqual({ file: 'x', line: 1 });
    expect(parseDeepLink('?file=x&line=-3')).toEqual({ file: 'x', line: 1 });
  });

  it('takes the integer part of a fractional line', () => {
    expect(parseDeepLink('?file=x&line=12.9')).toEqual({ file: 'x', line: 12 });
  });

  it('URL-decodes the path', () => {
    expect(parseDeepLink('?file=src%2Fa%20b.ts&line=2')).toEqual({ file: 'src/a b.ts', line: 2 });
  });
});
