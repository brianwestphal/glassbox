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

function TreeView({ node, depth, annotationCounts }: { node: TreeNode; depth: number; annotationCounts: Record<string, number> }) {
  const sortedChildren = [...node.children].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      {sortedChildren.map(child => {
        const total = countFiles(child);
        const isCollapsible = total > 1;
        return (
          <div className="folder-group">
            <div className={`folder-header${isCollapsible ? ' collapsible' : ''}`} style={`padding-left:${16 + depth * 12}px`}>
              {isCollapsible ? <span className="folder-arrow">▾</span> : <span className="folder-arrow-spacer"></span>}
              <span className="folder-name">{child.name}/</span>
            </div>
            <div className="folder-content">
              <TreeView node={child} depth={depth + 1} annotationCounts={annotationCounts} />
            </div>
          </div>
        );
      })}
      {node.files.map(f => {
        const diff = JSON.parse(f.diff_data || '{}');
        const count = annotationCounts[f.id] || 0;
        const fileName = f.file_path.split('/').pop()!;
        return (
          <div className="file-item" data-file-id={f.id} style={`padding-left:${16 + depth * 12}px`}>
            <span className={`status-dot ${f.status}`}></span>
            <span className="file-name" title={f.file_path}>{fileName}</span>
            <span className={`file-status ${diff.status || ''}`}>{diff.status || ''}</span>
            {count > 0 ? <span className="annotation-count">{count}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function FileList({ files, annotationCounts }: { files: ReviewFile[]; annotationCounts: Record<string, number> }) {
  const tree = buildFileTree(files);

  return (
    <div className="file-list">
      <div className="file-list-items">
        <TreeView node={tree} depth={0} annotationCounts={annotationCounts} />
      </div>
    </div>
  );
}
