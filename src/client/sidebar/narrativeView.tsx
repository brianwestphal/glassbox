import { selectFile } from '../diff/selection.js';
import { toElement } from '../dom.js';
import { state } from '../state.js';

export function renderNarrativeFileList(container: Element) {
  const order = state.narrativeOrder;
  const filterQ = state.filterText.toLowerCase();

  // Build set of ordered file IDs
  const orderedFileIds = new Set(order?.map(o => o.reviewFileId) ?? []);

  // Sort by position
  const sorted = order !== null
    ? order.slice().sort((a, b) => a.position - b.position)
    : [];

  // Unscored files in original flat order
  const unscored = state.files.filter(f => !orderedFileIds.has(f.id));

  // Apply filter
  const filteredOrdered = filterQ !== ''
    ? sorted.filter(s => s.filePath.toLowerCase().includes(filterQ))
    : sorted;
  const filteredUnscored = filterQ !== ''
    ? unscored.filter(f => f.file_path.toLowerCase().includes(filterQ))
    : unscored;

  state.fileOrder = [];

  // Render ordered files first
  for (const item of filteredOrdered) {
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

  // Render unscored files in flat original order
  for (const file of filteredUnscored) {
    const fileName = file.file_path.split('/').pop() ?? '';
    const count = state.annotationCounts[file.id] ?? 0;
    const staleCount = state.staleCounts[file.id] ?? 0;

    const el = toElement(
      <div className={`file-item${file.id === state.currentFileId ? ' active' : ''}`}
        data-file-id={file.id} style="padding-left: 16px">
        <span className="file-name" title={file.file_path}>{fileName}</span>
        <span className="file-path-dim" title={file.file_path}>
          {file.file_path.includes('/') ? file.file_path.slice(0, file.file_path.lastIndexOf('/')) : ''}
        </span>
        {staleCount > 0 ? <span className="stale-dot"></span> : null}
        {count > 0 ? <span className="annotation-count">{count}</span> : null}
      </div>
    );

    el.addEventListener('click', () => { void selectFile(file.id); });
    container.appendChild(el);
    state.fileOrder.push(file.id);
  }
}
