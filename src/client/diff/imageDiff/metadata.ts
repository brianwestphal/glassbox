import { api } from '../../api.js';

export async function loadMetadata(fileId: string, container: Element): Promise<void> {
  const panel = container.querySelector('.image-diff-metadata');
  if (!panel) return;
  try {
    const data = await api<{ old: string[] | null; new: string[] | null }>(`/image/${fileId}/metadata`);
    renderMetadataDiff(panel, data.old, data.new);
  } catch {
    panel.innerHTML = '<div class="image-metadata-error">Could not load metadata</div>';
  }
}

function renderMetadataDiff(panel: Element, oldLines: string[] | null, newLines: string[] | null): void {
  if (oldLines === null && newLines === null) {
    panel.innerHTML = '<div class="image-metadata-error">No metadata available</div>';
    return;
  }
  if (oldLines === null || newLines === null) {
    const lines = oldLines ?? newLines;
    if (lines === null) return;
    panel.innerHTML = '<div class="image-metadata-single">' +
      lines.map(l => `<div class="metadata-line">${esc(l)}</div>`).join('') + '</div>';
    return;
  }
  const allKeys = new Set<string>();
  const oldMap = new Map<string, string>();
  const newMap = new Map<string, string>();
  for (const line of oldLines) { const [key] = line.split(': ', 1); oldMap.set(key, line); allKeys.add(key); }
  for (const line of newLines) { const [key] = line.split(': ', 1); newMap.set(key, line); allKeys.add(key); }
  let html = '<div class="image-metadata-diff">';
  for (const key of allKeys) {
    const o = oldMap.get(key);
    const n = newMap.get(key);
    if (o !== undefined && n !== undefined && o === n) {
      html += `<div class="metadata-line context">${esc(o)}</div>`;
    } else {
      if (o !== undefined) html += `<div class="metadata-line remove">${esc(o)}</div>`;
      if (n !== undefined) html += `<div class="metadata-line add">${esc(n)}</div>`;
    }
  }
  panel.innerHTML = html + '</div>';
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
