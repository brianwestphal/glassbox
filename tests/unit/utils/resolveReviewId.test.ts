import { resolveReviewId } from '../../../src/utils/resolveReviewId.js';

function makeContext(query: string | undefined, middleware: string): Parameters<typeof resolveReviewId>[0] {
  return {
    req: { query: () => query },
    get: (k: string) => (k === 'reviewId' ? middleware : ''),
  } as unknown as Parameters<typeof resolveReviewId>[0];
}

describe('resolveReviewId', () => {
  it('returns the query param when present', () => {
    expect(resolveReviewId(makeContext('q-123', 'mw-456'))).toBe('q-123');
  });

  it('falls back to middleware when query is missing', () => {
    expect(resolveReviewId(makeContext(undefined, 'mw-456'))).toBe('mw-456');
  });

  it('returns the query param even if empty string is explicitly set (no fallback)', () => {
    // Hono returns undefined for missing params, so explicit empty string is a real value.
    expect(resolveReviewId(makeContext('', 'mw-456'))).toBe('');
  });
});
