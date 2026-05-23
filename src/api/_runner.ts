/**
 * Internal client-runtime helpers for the typed API layer.
 *
 * Per-resource modules (annotations.ts, reviews.ts, …) define the request
 * and response *schemas* (which the server also imports for parsing
 * incoming bodies) alongside the typed *caller functions* that wrap
 * `apiCall()` into shapes like `createAnnotation(req)` / `getContext(req)`.
 *
 * The runtime client validates responses with the same schemas — drift
 * between client expectation and server reality fails loudly with a
 * descriptive error rather than producing silent undefineds downstream.
 *
 * Server-side code imports the schemas defined alongside the typed
 * callers for request validation. This module deliberately uses `fetch`
 * + a lazy `document.body.dataset.reviewId` lookup rather than going
 * through `src/client/api.ts` so that pulling the schemas server-side
 * doesn't drag the client-only `stores/index.ts` (which dereferences
 * `document` at module load) into the server's module graph.
 */
import { z } from 'zod';

/** Shared `{ ok: true }` shape used by every mutating endpoint that has
 *  nothing meaningful to return. Centralized here so it doesn't appear
 *  as duplicate exports in the aggregated `apis` namespace. */
export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

/** Resolve the current review id from the page DOM. Lazy by design so
 *  that simply importing this module (e.g. from a server route file
 *  pulling in a Req schema) doesn't touch `document`. */
function currentReviewId(): string {
  if (typeof document === 'undefined') return '';
  return document.body.dataset.reviewId ?? '';
}

/**
 * Typed API call with response validation. Fetches `path`, parses JSON,
 * and validates against `responseSchema`. Throws on validation failure
 * with a path-qualified error message — never silently returns the wrong
 * shape.
 *
 * The optional `body` is JSON-serialized in place; callers pass a plain
 * object, never a pre-stringified body.
 */
export async function apiCall<T>(
  responseSchema: z.ZodType<T>,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = '/api' + path + separator + 'reviewId=' + encodeURIComponent(currentReviewId());
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    method: opts.method,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json: unknown = await res.json();
  const result = responseSchema.safeParse(json);
  if (!result.success) {
    const summary = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`API response from ${path} failed validation: ${summary}`);
  }
  return result.data;
}

/** Build a `?k=v&...` query string from a flat record. Skips `undefined`
 *  and `null` values; coerces everything else to string. Returns an empty
 *  string when no params are present, so callers can always concatenate
 *  it onto a path. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of entries) usp.set(k, String(v));
  return '?' + usp.toString();
}
