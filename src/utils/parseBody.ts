/**
 * Server-side request validation helpers backed by zod. Replaces the
 * hand-rolled `checkEnum` / `isNonEmptyString` ladders that previously
 * sat at the top of every POST/PATCH route — the schema is the source of
 * truth for what the wire shape must look like, and a failure produces a
 * structured 400 with the exact path that didn't validate.
 *
 * Why a function and not a middleware: keeping validation in the handler
 * body means the route can short-circuit by returning the prepared
 * Response on failure, which composes cleanly with Hono's typed
 * `c.json()` returns. A middleware would force us to attach the parsed
 * body to a context variable, which complicates the typing.
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

import { SAFE_SLUG_RE } from './safeSlug.js';

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Parse and validate a JSON request body against the given schema.
 * Returns either the parsed data or a `Response` ready to return from
 * the route (with status 400 and a structured error message). Callers
 * pattern-match on `.ok`.
 */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: 'Body must be valid JSON' }, 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues
      .map(i => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return { ok: false, response: c.json({ error: summary }, 400) };
  }
  return { ok: true, data: result.data };
}

/**
 * Parse and validate query parameters against the given schema. Pulls
 * every query value with `c.req.query()` (already a string-keyed record),
 * then runs it through the schema — which is responsible for any
 * string→number coercion via `z.coerce.number()` etc.
 */
export function parseQuery<T>(c: Context, schema: z.ZodType<T>): ParseResult<T> {
  const raw: Record<string, string> = c.req.query();
  const result = schema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues
      .map(i => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return { ok: false, response: c.json({ error: summary }, 400) };
  }
  return { ok: true, data: result.data };
}

/**
 * Read a required path parameter and ensure it's a non-empty string before it
 * is used in a database lookup (FR-14.2). Hono won't route a truly empty `:id`
 * segment, but this makes the contract explicit and returns a structured 400
 * for a blank/whitespace value rather than letting it fall through to a
 * downstream 404 / no-op. Callers pattern-match on `.ok` like `parseBody`.
 */
export function requirePathParam(c: Context, name: string): ParseResult<string> {
  const value = c.req.param(name);
  if (value === undefined || value.trim() === '') {
    return { ok: false, response: c.json({ error: `Missing or empty path parameter: ${name}` }, 400) };
  }
  return { ok: true, data: value };
}

/**
 * Like `requirePathParam`, but additionally requires the value to be a safe
 * slug (`SAFE_SLUG_RE`). Use for any path parameter that reaches the
 * filesystem (plugin ids, theme ids) — Hono percent-decodes params, so
 * without this an encoded `..%2F..%2F<dir>` id would escape the target
 * directory before hitting `rmSync`/`unlinkSync` (doc 14, FR-14.2).
 */
export function requireSlugParam(c: Context, name: string): ParseResult<string> {
  const value = requirePathParam(c, name);
  if (!value.ok) return value;
  if (!SAFE_SLUG_RE.test(value.data)) {
    return { ok: false, response: c.json({ error: `Invalid ${name}: must be alphanumeric with . _ - (no path separators)` }, 400) };
  }
  return value;
}

/** Build a structured-error JSON response without going through the
 *  parseBody helpers. Used by route handlers that need to reject for
 *  reasons that aren't schema-validation failures (e.g. a referenced
 *  resource not existing). */
export function errorResponse(c: Context, message: string, status: ContentfulStatusCode = 400): Response {
  return c.json({ error: message }, status);
}
