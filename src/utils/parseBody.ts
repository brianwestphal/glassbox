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

/** Build a structured-error JSON response without going through the
 *  parseBody helpers. Used by route handlers that need to reject for
 *  reasons that aren't schema-validation failures (e.g. a referenced
 *  resource not existing). */
export function errorResponse(c: Context, message: string, status: ContentfulStatusCode = 400): Response {
  return c.json({ error: message }, status);
}
