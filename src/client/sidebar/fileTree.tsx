import { api } from '../api.js';
import type { ReviewFile } from '../state.js';
import { reviewStore } from '../stores/index.js';

interface FilesResponse {
  files: ReviewFile[];
  annotationCounts: Record<string, number>;
  staleCounts?: Record<string, number>;
}

export async function loadFiles(): Promise<void> {
  const data = await api<FilesResponse>('/files');
  reviewStore.actions.update({
    files: data.files,
    annotationCounts: data.annotationCounts,
    staleCounts: data.staleCounts ?? {},
  });
}
