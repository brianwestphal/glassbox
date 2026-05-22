import type { SafeHtml } from 'kerfjs';

import { getImageMetadata } from '../../../api/index.js';
import { toElement } from '../../dom.js';

export async function loadMetadata(fileId: string, container: Element): Promise<void> {
  const panel = container.querySelector('.image-diff-metadata');
  if (!panel) return;
  try {
    const data = await getImageMetadata({ fileId });
    panel.replaceChildren(toElement(renderMetadataBody(data.old, data.new)));
  } catch {
    panel.replaceChildren(toElement(<div className="image-metadata-error">Could not load metadata</div>));
  }
}

function renderMetadataBody(oldLines: string[] | null, newLines: string[] | null): SafeHtml {
  if (oldLines === null && newLines === null) {
    return <div className="image-metadata-error">No metadata available</div>;
  }
  if (oldLines === null || newLines === null) {
    const lines = oldLines ?? newLines ?? [];
    return (
      <div className="image-metadata-single">
        {lines.map(l => <div className="metadata-line">{l}</div>)}
      </div>
    );
  }
  return <div className="image-metadata-diff">{renderDiffLines(oldLines, newLines)}</div>;
}

function renderDiffLines(oldLines: string[], newLines: string[]): SafeHtml[] {
  const allKeys = new Set<string>();
  const oldMap = new Map<string, string>();
  const newMap = new Map<string, string>();
  for (const line of oldLines) { const [key] = line.split(': ', 1); oldMap.set(key, line); allKeys.add(key); }
  for (const line of newLines) { const [key] = line.split(': ', 1); newMap.set(key, line); allKeys.add(key); }
  const out: SafeHtml[] = [];
  for (const key of allKeys) {
    const o = oldMap.get(key);
    const n = newMap.get(key);
    if (o !== undefined && n !== undefined && o === n) {
      out.push(<div className="metadata-line context">{o}</div>);
    } else {
      if (o !== undefined) out.push(<div className="metadata-line remove">{o}</div>);
      if (n !== undefined) out.push(<div className="metadata-line add">{n}</div>);
    }
  }
  return out;
}
