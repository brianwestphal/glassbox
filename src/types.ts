import type { Env } from 'hono';

export interface AppEnv extends Env {
  Variables: {
    reviewId: string;
    currentReviewId: string;
    repoRoot: string;
  };
}
