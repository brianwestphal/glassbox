import type { SafeHtml } from 'kerfjs';

import { parseDiffData } from '../../git/parseDiffData.js';
import { api, clientLog } from '../api.js';
import { selectFile } from '../diff/selection.js';
import { toElement } from '../dom.js';
import type { AnalysisModeState, ReviewFile, TreeNode } from '../state.js';
import { aiStore, diffViewStore, reviewStore } from '../stores/index.js';
import { renderNarrativeFileList } from './narrativeView.js';
import { renderRiskFileList } from './riskView.js';

interface FilesResponse {
  files: ReviewFile[];
  annotationCounts: Record<string, number>;
  staleCounts?: Record<string, number>;
}

export async function loadFiles() {
  const data = await api<FilesResponse>('/files');
  reviewStore.actions.update({
    files: data.files,
    annotationCounts: data.annotationCounts,
    staleCounts: data.staleCounts ?? {},
  });
  restoreCollapsedFolders();
  renderFileList();
}

function renderProgressBar(modeState: AnalysisModeState, analysisLabel: string): SafeHtml {
  const completed = modeState.progressCompleted;
  const total = modeState.progressTotal;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const label = total > 0
    ? `${analysisLabel}... ${String(completed)}/${String(total)}`
    : `${analysisLabel}...`;

  return (
    <div className="analysis-loading-inline">
      <div className="analysis-spinner analysis-spinner-sm"></div>
      <div className="analysis-progress-info">
        <span>{label}</span>
        {total > 0 && (
          <div className="analysis-progress-bar">
            <div className="analysis-progress-fill" style={`width: ${String(pct)}%`}></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function renderFileList() {
  const list = document.querySelector('.file-list-items');
  if (list === null) return;
  list.innerHTML = '';
  reviewStore.actions.update({ fileOrder: [] });

  const ai = aiStore.state.value;

  // Show analysis spinner if running
  if (ai.sortMode === 'risk' && ai.riskAnalysis.status === 'running') {
    list.appendChild(toElement(renderProgressBar(ai.riskAnalysis, 'Analyzing risk')));
  } else if (ai.sortMode === 'narrative' && ai.narrativeAnalysis.status === 'running') {
    list.appendChild(toElement(renderProgressBar(ai.narrativeAnalysis, 'Analyzing reading order')));
  }
  // Show guided analysis spinner (independent of sort mode)
  if (ai.guidedReviewEnabled && ai.guidedAnalysis.status === 'running') {
    list.appendChild(toElement(renderProgressBar(ai.guidedAnalysis, 'Guided review')));
  }

  // Show error for AI modes
  if (ai.sortMode === 'risk' && ai.riskAnalysis.status === 'failed') {
    list.appendChild(toElement(
      <div className="analysis-error">
        <span>{'Analysis failed: ' + (ai.riskAnalysis.error ?? 'Unknown error')}</span>
        <button className="btn btn-xs btn-primary" id="retry-analysis">Retry</button>
      </div>
    ));
    const retryBtn = list.querySelector('#retry-analysis');
    if (retryBtn !== null) {
      retryBtn.addEventListener('click', () => {
        void import('./sortMode.js').then(m => { m.triggerAnalysis('risk'); });
      });
    }
  } else if (ai.sortMode === 'narrative' && ai.narrativeAnalysis.status === 'failed') {
    list.appendChild(toElement(
      <div className="analysis-error">
        <span>{'Analysis failed: ' + (ai.narrativeAnalysis.error ?? 'Unknown error')}</span>
        <button className="btn btn-xs btn-primary" id="retry-analysis">Retry</button>
      </div>
    ));
    const retryBtn = list.querySelector('#retry-analysis');
    if (retryBtn !== null) {
      retryBtn.addEventListener('click', () => {
        void import('./sortMode.js').then(m => { m.triggerAnalysis('narrative'); });
      });
    }
  }

  // Dispatch file rendering based on sort mode
  if (ai.sortMode === 'risk') {
    clientLog(`renderFileList: risk — rendering files (scores: ${String(ai.riskScores?.length ?? 0)})`);
    renderRiskFileList(list);
    return;
  }

  if (ai.sortMode === 'narrative') {
    clientLog(`renderFileList: narrative — rendering files (order: ${String(ai.narrativeOrder?.length ?? 0)})`);
    renderNarrativeFileList(list);
    return;
  }

  // Default: folder view
  const review = reviewStore.state.value;
  let filtered = review.files;
  if (review.filterText !== '') {
    const q = review.filterText.toLowerCase();
    filtered = review.files.filter(f => f.file_path.toLowerCase().indexOf(q) !== -1);
  }
  const tree = buildFileTree(filtered);
  renderTreeNode(list, tree, 0, '');
}

function buildFileTree(files: ReviewFile[]): TreeNode {
  const root: TreeNode = { name: '', children: [], files: [] };
  files.forEach(f => {
    const parts = f.file_path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let child = node.children.find(c => c.name === parts[i]);
      if (child === undefined) {
        child = { name: parts[i], children: [], files: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.files.push(f);
  });
  compressTree(root);
  return root;
}

function compressTree(node: TreeNode) {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    while (child.children.length === 1 && child.files.length === 0) {
      const gc = child.children[0];
      child = { name: child.name + '/' + gc.name, children: gc.children, files: gc.files };
      node.children[i] = child;
    }
    compressTree(child);
  }
}

function countTreeFiles(node: TreeNode): number {
  let count = node.files.length;
  node.children.forEach(c => { count += countTreeFiles(c); });
  return count;
}

function hasStaleInTree(node: TreeNode): boolean {
  const staleCounts = reviewStore.state.value.staleCounts;
  for (let i = 0; i < node.files.length; i++) {
    if ((staleCounts[node.files[i].id] ?? 0) > 0) return true;
  }
  for (let i = 0; i < node.children.length; i++) {
    if (hasStaleInTree(node.children[i])) return true;
  }
  return false;
}

function renderTreeNode(container: Element, node: TreeNode, depth: number, pathPrefix: string) {
  const sortedChildren = node.children.slice().sort((a, b) => a.name.localeCompare(b.name));
  const pad = (d: number) => `padding-left: ${String(16 + d * 12)}px`;

  sortedChildren.forEach(child => {
    const folderPath = pathPrefix !== '' ? pathPrefix + '/' + child.name : child.name;
    const total = countTreeFiles(child);
    const isCollapsible = total > 1;
    const isCollapsed = isCollapsible && diffViewStore.state.value.collapsedFolders.has(folderPath);
    const stale = hasStaleInTree(child);

    const group = toElement(
      <div className="folder-group">
        <div className={`folder-header${isCollapsible ? ' collapsible' : ''}${isCollapsed ? ' collapsed' : ''}`} style={pad(depth)}>
          {isCollapsible
            ? <span className="folder-arrow">{'\u25BE'}</span>
            : <span className="folder-arrow-spacer"></span>}
          <span className="folder-name">{child.name}/</span>
          {stale && <span className="stale-dot"></span>}
        </div>
        <div className="folder-content"></div>
      </div>
    );

    if (isCollapsible) {
      const header = group.querySelector('.folder-header');
      if (header !== null) {
        header.addEventListener('click', () => {
          header.classList.toggle('collapsed');
          if (header.classList.contains('collapsed')) {
            diffViewStore.actions.addCollapsedFolder(folderPath);
          } else {
            diffViewStore.actions.removeCollapsedFolder(folderPath);
          }
          saveCollapsedFolders();
        });
      }
    }

    const folderContent = group.querySelector('.folder-content');
    if (folderContent !== null) {
      renderTreeNode(folderContent, child, depth + 1, folderPath);
    }
    container.appendChild(group);
  });

  const review = reviewStore.state.value;
  node.files.forEach(f => {
    const diff = parseDiffData(f.diff_data);
    const count = review.annotationCounts[f.id] ?? 0;
    const staleCount = review.staleCounts[f.id] ?? 0;
    const fileName = f.file_path.split('/').pop() ?? '';

    const el = toElement(
      <div className={`file-item${f.id === review.currentFileId ? ' active' : ''}`} data-file-id={f.id} style={pad(depth)}>
        <span className={`status-dot ${f.status}`}></span>
        <span className="file-name" title={f.file_path}>{fileName}</span>
        <span className={`file-status ${diff?.status ?? ''}`}>{diff?.status ?? ''}</span>
        {staleCount > 0 ? <span className="stale-dot"></span> : null}
        {count > 0 ? <span className="annotation-count">{count}</span> : null}
      </div>
    );
    el.addEventListener('click', () => { void selectFile(f.id); });
    container.appendChild(el);
    reviewStore.actions.pushFileOrder(f.id);
  });
}

function storageKey(): string {
  return 'glassbox-collapsed-' + reviewStore.state.value.reviewId;
}

function saveCollapsedFolders() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...diffViewStore.state.value.collapsedFolders]));
  } catch { /* localStorage unavailable */ }
}

function restoreCollapsedFolders() {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored !== null) {
      diffViewStore.actions.update({ collapsedFolders: new Set(JSON.parse(stored) as string[]) });
    }
  } catch { /* localStorage unavailable */ }
}
