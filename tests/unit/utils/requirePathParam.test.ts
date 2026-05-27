import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';

import { requirePathParam } from '../../../src/utils/parseBody.js';

/**
 * GB-824 (FR-14.2) — path parameters must be validated as non-empty before use
 * in a DB lookup, returning a 400 on a blank value rather than falling through
 * to a downstream 404 / no-op.
 */
function mockContext(params: Record<string, string | undefined>): Context {
  return {
    req: { param: (n: string) => params[n] },
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  } as unknown as Context;
}

describe('requirePathParam (FR-14.2)', () => {
  it('accepts a present, non-empty value', () => {
    const result = requirePathParam(mockContext({ id: 'abc123' }), 'id');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('abc123');
  });

  it('rejects an empty string with a 400', async () => {
    const result = requirePathParam(mockContext({ id: '' }), 'id');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json() as { error: string };
      expect(body.error).toContain('id');
    }
  });

  it('rejects a whitespace-only value', () => {
    expect(requirePathParam(mockContext({ id: '   ' }), 'id').ok).toBe(false);
  });

  it('rejects a missing (undefined) param', () => {
    expect(requirePathParam(mockContext({}), 'fileId').ok).toBe(false);
  });
});
