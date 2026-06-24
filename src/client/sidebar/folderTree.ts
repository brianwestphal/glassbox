import type { ReviewFile } from '../state.js';

/** The final path segment of a forward-slash path (`src/a/b.ts` → `b.ts`).
 *  Returns the whole path when it has no slash. */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** The directory portion of a forward-slash path (`src/a/b.ts` → `src/a`),
 *  or '' when the path has no directory. */
export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

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

/** Order a folder's files most-different-first by perceptual difference score
 *  (doc 26 P2), then by path. Files without a score (every non-ground-truth
 *  review) sort by path, so this is a no-op outside ground-truth mode. */
export function sortFilesByScore(files: ReviewFile[]): ReviewFile[] {
  return files.slice().sort((a, b) =>
    (b.difference_score ?? -1) - (a.difference_score ?? -1) || a.file_path.localeCompare(b.file_path));
}

/** Append every file ID in folder-traversal order (alphabetical children,
 *  then own files by difference score) into `out`. Used by `visibleFileOrder`
 *  so keyboard navigation (j/k) traverses files in the same order they appear
 *  on screen in folder sort mode. */
export function walkTreeFiles(node: TreeNode, out: string[]): void {
  const sortedChildren = node.children.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const child of sortedChildren) walkTreeFiles(child, out);
  for (const f of sortFilesByScore(node.files)) out.push(f.id);
}
