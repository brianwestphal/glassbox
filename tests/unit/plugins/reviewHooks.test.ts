/**
 * Review lifecycle hooks (doc 31 FR-31.3): notifyReviewCreated /
 * notifyReviewCompleted fire every loaded plugin's hook fail-soft, map the DB
 * rows to the stable plugin-facing shapes, and skip disabled/hookless plugins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AnnotationWithFilePath, Review } from '../../../src/db/schemas.js';
import {
  __resetContentPluginsForTest,
  __setContentRegistryForTest,
  notifyReviewCompleted,
  notifyReviewCreated,
} from '../../../src/plugins/index.js';
import type { LoadedPlugin } from '../../../src/plugins/loader.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import type { PluginContext, ReviewHooks } from '../../../src/plugins/types.js';

const ctx: PluginContext = {
  log: () => {},
  getSetting: () => Promise.resolve(null),
  setSetting: () => Promise.resolve(),
  updateConfigLabel: () => {},
  registerUI: () => {},
};

function review(over: Partial<Review> = {}): Review {
  return {
    id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'uncommitted', mode_args: null,
    head_commit: null, status: 'completed', created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
  };
}

function annotation(over: Partial<AnnotationWithFilePath> = {}): AnnotationWithFilePath {
  return {
    id: 'a1', review_file_id: 'f1', file_path: 'src/x.ts', line_number: 12, side: 'new',
    category: 'bug', content: 'boom', is_stale: false, original_content: null,
    reply_to_note_id: null, region_data: null, created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
  };
}

function loadedWith(hooks: ReviewHooks, id = 'p'): LoadedPlugin {
  return { id, dir: '/x', manifest: null, status: 'loaded', registration: { reviewHooks: hooks }, instance: { activate: () => {} }, context: ctx };
}

afterEach(() => __resetContentPluginsForTest());

describe('notifyReviewCreated (doc 31)', () => {
  it('fires onReviewCreated with the mapped review + the plugin context', async () => {
    const onReviewCreated = vi.fn();
    __setContentRegistryForTest(new ContentPluginRegistry(), [loadedWith({ onReviewCreated })]);
    await notifyReviewCreated(review({ repo_name: 'proj', mode: 'branch' }));
    expect(onReviewCreated).toHaveBeenCalledTimes(1);
    expect(onReviewCreated).toHaveBeenCalledWith(
      { id: 'r1', repoPath: '/repo', repoName: 'proj', mode: 'branch', status: 'completed' },
      ctx,
    );
  });

  it('is a no-op for a plugin without the hook', async () => {
    __setContentRegistryForTest(new ContentPluginRegistry(), [loadedWith({})]);
    await expect(notifyReviewCreated(review())).resolves.toBeUndefined();
  });
});

describe('notifyReviewCompleted (doc 31)', () => {
  it('fires with the mapped annotations + export path', async () => {
    const onReviewCompleted = vi.fn();
    __setContentRegistryForTest(new ContentPluginRegistry(), [loadedWith({ onReviewCompleted })]);
    await notifyReviewCompleted(review(), [annotation()], '/repo/.glassbox/latest-review.md');
    expect(onReviewCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1' }),
      [{ id: 'a1', filePath: 'src/x.ts', lineNumber: 12, side: 'new', category: 'bug', content: 'boom' }],
      '/repo/.glassbox/latest-review.md',
      ctx,
    );
  });

  it('is fail-soft: a throwing hook is swallowed and the others still fire', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('nope'));
    const ok = vi.fn();
    __setContentRegistryForTest(new ContentPluginRegistry(), [
      loadedWith({ onReviewCompleted: boom }, 'bad'),
      loadedWith({ onReviewCompleted: ok }, 'good'),
    ]);
    await expect(notifyReviewCompleted(review(), [], '/x.md')).resolves.toBeUndefined();
    expect(boom).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
  });

  it('skips a plugin that failed to load (status !== loaded)', async () => {
    const onReviewCompleted = vi.fn();
    const bad: LoadedPlugin = { ...loadedWith({ onReviewCompleted }), status: 'error' };
    __setContentRegistryForTest(new ContentPluginRegistry(), [bad]);
    await notifyReviewCompleted(review(), [], '/x.md');
    expect(onReviewCompleted).not.toHaveBeenCalled();
  });
});
