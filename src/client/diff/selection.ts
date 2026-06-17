import { setFileStatus } from '../../api/index.js';
import { reviewStore } from '../stores/index.js';
import { updateNavFilePath } from './index.js';
import { navPush } from './navStack.js';

/** Select a file: updates `currentFileId`, marks it as reviewed on first visit,
 *  and pushes a nav-stack entry. The actual diff fetch + render happens
 *  reactively in `diff/index.tsx` (the `initDiffView()` mount + fetch effect). */
export async function selectFile(fileId: string): Promise<void> {
  reviewStore.actions.update({ currentFileId: fileId });
  const file = reviewStore.state.value.files.find(f => f.id === fileId);
  navPush({ fileId, filePath: file?.file_path ?? null, scrollLine: 1 });
  updateNavFilePath(file?.file_path ?? '');

  // Mark as reviewed on first visit
  if (file !== undefined && file.status === 'pending') {
    await setFileStatus({ fileId, status: 'reviewed' });
    // Progress bar is reactive — the effect in `review/progress.tsx` fires
    // automatically on this store update.
    reviewStore.actions.setFileStatus(fileId, 'reviewed');
  }
}

// Re-exported for callers that import from this module historically.
export { updateNavFilePath, updateToolbarLanguage } from './index.js';
