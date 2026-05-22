/**
 * Internal client-runtime helpers for the typed API layer.
 *
 * Per-resource modules (annotations.ts, reviews.ts, …) define the request
 * and response *types* (which the server also imports via `import type`)
 * alongside the typed *caller functions* that wrap `api()` into shapes
 * like `createAnnotation(req)` / `getContext(req)`.
 *
 * This module only re-exports the client fetch helper and a tiny query
 * string builder. It is **client-only** at runtime — the server never
 * calls its own API, so it never needs the runtime side of `src/api/`,
 * only the types.
 */

import { api } from '../client/api.js';

export { api };

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
