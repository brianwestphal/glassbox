/**
 * GB-1135 — the sidebar collapses `.pr-notes` note-storage folders by default.
 * `noteStorageFolderKeys` returns the folder-tree keys to seed as collapsed.
 */
import { describe, expect, it } from 'vitest';

import type { ReviewFile } from '../../../src/client/state.js';
import { noteStorageFolderKeys } from '../../../src/client/sidebar/folderTree.js';

function file(path: string): ReviewFile {
  return { id: path, review_id: 'r', file_path: path, status: 'pending', diff_data: null, created_at: '' };
}

describe('noteStorageFolderKeys (GB-1135)', () => {
  it('returns [] when no file lives under .pr-notes', () => {
    expect(noteStorageFolderKeys([file('src/a.ts'), file('src/b.ts')])).toEqual([]);
  });

  it('returns the compressed top-level .pr-notes folder key when notes coexist with source', () => {
    const files = [
      file('src/a.ts'),
      file('src/b.ts'),
      file('.pr-notes/notes/src/x.ts.000000.sarif'),
      file('.pr-notes/notes/src/y.ts.000000.sarif'),
    ];
    // The `.pr-notes/notes/src` chain compresses to a single node; its key
    // begins with `.pr-notes`, matching the sidebar's `folderPath` for it.
    expect(noteStorageFolderKeys(files)).toEqual(['.pr-notes/notes/src']);
  });

  it('matches a fully-compressed .pr-notes chain in a notes-only tree', () => {
    const files = [file('.pr-notes/notes/src/client/diff/toolbar.tsx.000000.sarif')];
    expect(noteStorageFolderKeys(files)).toEqual(['.pr-notes/notes/src/client/diff']);
  });
});
