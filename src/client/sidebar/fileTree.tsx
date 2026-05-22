import { listFiles } from '../../api/index.js';
import { reviewStore } from '../stores/index.js';

export async function loadFiles(): Promise<void> {
  const data = await listFiles();
  reviewStore.actions.update({
    files: data.files,
    annotationCounts: data.annotationCounts,
    staleCounts: data.staleCounts,
  });
}
