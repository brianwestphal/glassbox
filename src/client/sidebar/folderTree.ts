import type { ReviewFile } from '../state.js';

export interface TreeNode {
  name: string;
  children: TreeNode[];
  files: ReviewFile[];
}

/** Build a folder tree from a flat list of review files. Folders with only
 *  one nested folder and no files are compressed into a single
 *  `a/b/c` node (matches the sidebar's compact folder rendering). */
export function buildFolderTree(files: ReviewFile[]): TreeNode {
  const root: TreeNode = { name: '', children: [], files: [] };
  for (const f of files) {
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
  }
  compressFolderTree(root);
  return root;
}

function compressFolderTree(node: TreeNode): void {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    while (child.children.length === 1 && child.files.length === 0) {
      const gc = child.children[0];
      child = { name: child.name + '/' + gc.name, children: gc.children, files: gc.files };
      node.children[i] = child;
    }
    compressFolderTree(child);
  }
}

/** Append every file ID in folder-traversal order (alphabetical children,
 *  then own files) into `out`. Used by `visibleFileOrder` so keyboard
 *  navigation (j/k) traverses files in the same order they appear on
 *  screen in folder sort mode. */
export function walkTreeFiles(node: TreeNode, out: string[]): void {
  const sortedChildren = node.children.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const child of sortedChildren) walkTreeFiles(child, out);
  for (const f of node.files) out.push(f.id);
}
