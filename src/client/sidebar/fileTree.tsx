import { api } from '../api.js';
import { selectFile } from '../diff/selection.js';
import { toElement } from '../dom.js';
import type { ReviewFile, TreeNode } from '../state.js';
import { state } from '../state.js';

interface FilesResponse {
  files: ReviewFile[];
  annotationCounts: Record<string, number>;
  staleCounts?: Record<string, number>;
}

interface DiffData {
  status?: string;
}

export async function loadFiles() {
  const data = await api<FilesResponse>('/files');
  state.files = data.files;
  state.annotationCounts = data.annotationCounts;
  state.staleCounts = data.staleCounts ?? {};
  restoreCollapsedFolders();
  renderFileList();
}

export function renderFileList() {
  const list = document.querySelector('.file-list-items');
  if (list === null) return;
  list.innerHTML = '';
  state.fileOrder = [];
  let filtered = state.files;
  if (state.filterText !== '') {
    const q = state.filterText.toLowerCase();
    filtered = state.files.filter(f => f.file_path.toLowerCase().indexOf(q) !== -1);
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
  for (let i = 0; i < node.files.length; i++) {
    if ((state.staleCounts[node.files[i].id] ?? 0) > 0) return true;
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
    const isCollapsed = isCollapsible && state.collapsedFolders.has(folderPath);
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
            state.collapsedFolders.add(folderPath);
          } else {
            state.collapsedFolders.delete(folderPath);
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

  node.files.forEach(f => {
    const diff: DiffData = JSON.parse(f.diff_data !== '' ? f.diff_data : '{}') as DiffData;
    const count = state.annotationCounts[f.id] ?? 0;
    const staleCount = state.staleCounts[f.id] ?? 0;
    const fileName = f.file_path.split('/').pop() ?? '';

    const el = toElement(
      <div className={`file-item${f.id === state.currentFileId ? ' active' : ''}`} data-file-id={f.id} style={pad(depth)}>
        <span className={`status-dot ${f.status}`}></span>
        <span className="file-name" title={f.file_path}>{fileName}</span>
        <span className={`file-status ${diff.status ?? ''}`}>{diff.status ?? ''}</span>
        {staleCount > 0 ? <span className="stale-dot"></span> : null}
        {count > 0 ? <span className="annotation-count">{count}</span> : null}
      </div>
    );
    el.addEventListener('click', () => { void selectFile(f.id); });
    container.appendChild(el);
    state.fileOrder.push(f.id);
  });
}

function storageKey(): string {
  return 'glassbox-collapsed-' + state.reviewId;
}

function saveCollapsedFolders() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...state.collapsedFolders]));
  } catch { /* localStorage unavailable */ }
}

function restoreCollapsedFolders() {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored !== null) {
      state.collapsedFolders = new Set(JSON.parse(stored) as string[]);
    }
  } catch { /* localStorage unavailable */ }
}
