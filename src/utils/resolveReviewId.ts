import type { Context } from 'hono';

import type { AppEnv } from '../types.js';

export function resolveReviewId(c: Context<AppEnv>): string {
  return c.req.query('reviewId') ?? c.get('reviewId');
}
