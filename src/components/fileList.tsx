import type { ReviewFile } from '../db/queries.js';

interface TreeNode {
  name: string;
  children: TreeNode[];
  files: ReviewFile[];
}

function buildFileTree(files: ReviewFile[]): TreeNode {
  const root: TreeNode = { name: '', children: [], files: [] };
  for (const f of files) {
    const parts = f.file_path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let child = node.children.find(c => c.name === parts[i]);
      if (!child) {
        child = { name: parts[i], children: [], files: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.files.push(f);
  }
  compressTree(root);
  return root;
}

function compressTree(node: TreeNode): void {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    while (child.children.length === 1 && child.files.length === 0) {
      const grandchild = child.children[0];
      child = { name: child.name + '/' + grandchild.name, children: grandchild.children, files: grandchild.files };
      node.children[i] = child;
    }
    compressTree(child);
  }
}

function countFiles(node: TreeNode): number {
  let count = node.files.length;
  for (const child of node.children) count += countFiles(child);
  return count;
}

function hasStale(node: TreeNode, staleCounts: Record<string, number>): boolean {
  for (const f of node.files) {
    if (staleCounts[f.id]) return true;
  }
  for (const child of node.children) {
    if (hasStale(child, staleCounts)) return true;
  }
  return false;
}

function TreeView({ node, depth, annotationCounts, staleCounts }: {
  node: TreeNode; depth: number;
  annotationCounts: Record<string, number>;
  staleCounts: Record<string, number>;
}) {
  const sortedChildren = [...node.children].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      {sortedChildren.map(child => {
        const total = countFiles(child);
        const isCollapsible = total > 1;
        const stale = hasStale(child, staleCounts);
        return (
          <div className="folder-group">
            <div className={`folder-header${isCollapsible ? ' collapsible' : ''}`} style={`padding-left:${16 + depth * 12}px`}>
              {isCollapsible ? <span className="folder-arrow">▾</span> : <span className="folder-arrow-spacer"></span>}
              <span className="folder-name">{child.name}/</span>
              {stale ? <span className="stale-dot"></span> : null}
            </div>
            <div className="folder-content">
              <TreeView node={child} depth={depth + 1} annotationCounts={annotationCounts} staleCounts={staleCounts} />
            </div>
          </div>
        );
      })}
      {node.files.map(f => {
        const diff = JSON.parse(f.diff_data || '{}');
        const count = annotationCounts[f.id] || 0;
        const stale = staleCounts[f.id] || 0;
        const fileName = f.file_path.split('/').pop()!;
        return (
          <div className="file-item" data-file-id={f.id} style={`padding-left:${16 + depth * 12}px`}>
            <span className={`status-dot ${f.status}`}></span>
            <span className="file-name" title={f.file_path}>{fileName}</span>
            <span className={`file-status ${diff.status || ''}`}>{diff.status || ''}</span>
            {stale > 0 ? <span className="stale-dot"></span> : null}
            {count > 0 ? <span className="annotation-count">{count}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function FileList({ files, annotationCounts, staleCounts }: {
  files: ReviewFile[];
  annotationCounts: Record<string, number>;
  staleCounts: Record<string, number>;
}) {
  const tree = buildFileTree(files);

  return (
    <div className="file-list">
      <div className="file-list-items">
        <TreeView node={tree} depth={0} annotationCounts={annotationCounts} staleCounts={staleCounts} />
      </div>
    </div>
  );
}
