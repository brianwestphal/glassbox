/**
 * Review lifecycle hook dispatch (doc 31) — split out of `plugins/index.ts`
 * so the public entry point stays lifecycle + dispatch. Fires every loaded
 * plugin's `onReviewCreated` / `onReviewCompleted` **fail-soft**: a throwing
 * hook is logged and skipped, never propagated (a plugin must not block the
 * review). Both are no-ops when the subsystem is disabled.
 */
import type { AnnotationWithFilePath, Review } from '../db/queries.js';
import { PLUGINS_ENABLED } from '../feature-flags.js';
import { getLoadedPlugins } from './index.js';
import type { AnnotationHookInfo, ReviewHookInfo } from './types.js';

function toReviewHookInfo(review: Review): ReviewHookInfo {
  return { id: review.id, repoPath: review.repo_path, repoName: review.repo_name, mode: review.mode, status: review.status };
}

function toAnnotationHookInfo(a: AnnotationWithFilePath): AnnotationHookInfo {
  return { id: a.id, filePath: a.file_path, lineNumber: a.line_number, side: a.side, category: a.category, content: a.content };
}

/** Fire every loaded plugin's `onReviewCreated` hook (doc 31 FR-31.3). */
export async function notifyReviewCreated(review: Review): Promise<void> {
  if (!PLUGINS_ENABLED) return;
  const info = toReviewHookInfo(review);
  for (const p of getLoadedPlugins()) {
    const hook = p.registration?.reviewHooks?.onReviewCreated;
    if (p.status !== 'loaded' || hook === undefined || p.context === undefined) continue;
    try { await hook(info, p.context); }
    catch (e) { console.warn(`  [plugin:${p.id}] onReviewCreated hook failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

/** Fire every loaded plugin's `onReviewCompleted` hook (doc 31 FR-31.3) with
 *  the review, its annotations, and the export path. */
export async function notifyReviewCompleted(review: Review, annotations: AnnotationWithFilePath[], exportPath: string): Promise<void> {
  if (!PLUGINS_ENABLED) return;
  const info = toReviewHookInfo(review);
  const anns = annotations.map(toAnnotationHookInfo);
  for (const p of getLoadedPlugins()) {
    const hook = p.registration?.reviewHooks?.onReviewCompleted;
    if (p.status !== 'loaded' || hook === undefined || p.context === undefined) continue;
    try { await hook(info, anns, exportPath, p.context); }
    catch (e) { console.warn(`  [plugin:${p.id}] onReviewCompleted hook failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}
