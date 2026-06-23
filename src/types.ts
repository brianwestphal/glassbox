import type { Env } from 'hono';

export interface AppEnv extends Env {
  Variables: {
    reviewId: string;
    currentReviewId: string;
    repoRoot: string;
    /** The `--on-complete <command>` hook (doc 2 / GB-974), or null when unset.
     *  Set once at server start from the user's CLI invocation; never from
     *  network input. */
    onCompleteCommand: string | null;
  };
}
