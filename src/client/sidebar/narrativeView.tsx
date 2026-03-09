import { selectFile } from '../diff/selection.js';
import { toElement } from '../dom.js';
import { state } from '../state.js';

export function renderNarrativeFileList(container: Element) {
  const order = state.narrativeOrder;
  if (order === null) return;

  // Sort by position
  const sorted = order.slice().sort((a, b) => a.position - b.position);

  // Apply filter
  const filtered = state.filterText !== ''
    ? sorted.filter(s => s.filePath.toLowerCase().includes(state.filterText.toLowerCase()))
    : sorted;

  state.fileOrder = [];

  for (const item of filtered) {
    const file = state.files.find(f => f.id === item.reviewFileId);
    if (file === undefined) continue;

    const fileName = item.filePath.split('/').pop() ?? '';
    const count = state.annotationCounts[item.reviewFileId] ?? 0;
    const staleCount = state.staleCounts[item.reviewFileId] ?? 0;

    const el = toElement(
      <div className={`file-item${item.reviewFileId === state.currentFileId ? ' active' : ''}`}
        data-file-id={item.reviewFileId} style="padding-left: 16px">
        <span className="narrative-position">{item.position}</span>
        <span className="file-name" title={item.filePath}>{fileName}</span>
        <span className="file-path-dim" title={item.filePath}>
          {item.filePath.includes('/') ? item.filePath.slice(0, item.filePath.lastIndexOf('/')) : ''}
        </span>
        {staleCount > 0 ? <span className="stale-dot"></span> : null}
        {count > 0 ? <span className="annotation-count">{count}</span> : null}
      </div>
    );

    // Show rationale on hover via title
    if (item.rationale !== '') {
      (el.querySelector('.narrative-position') as HTMLElement).title = item.rationale;
    }

    el.addEventListener('click', () => { void selectFile(item.reviewFileId); });
    container.appendChild(el);
    state.fileOrder.push(item.reviewFileId);
  }
}
