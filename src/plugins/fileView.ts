/**
 * Content-plugin integration for the file diff viewer (doc 29 FR-29.2 — the
 * second integration point, alongside review-note artifacts). Given a file's
 * diff, ask the dispatcher to render/diff the whole file with an installed
 * plugin; the result is handed to `DiffView`, which shows it in place of the
 * built-in text diff. No match (the default) → `null` → the built-in view is
 * unchanged (FR-29.14, NFR-29.3).
 *
 * A cheap path pre-check (`mightHandleFile`) gates content reading, so with no
 * plugin installed nothing is read and this is a true no-op. Scope: text content
 * types (the content is read as UTF-8 text). Binary content types (raw bytes —
 * e.g. CAD) are a follow-up; binary files are skipped here.
 */
import type { FileDiff } from '../git/diff.js';
import { getModeFileContent } from '../git/diff.js';
import type { ReviewMode } from '../git/types.js';
import { diffContent, mightHandleFile, pluginsEnabled, renderContent } from './index.js';
import type { RenderedView } from './types.js';

/**
 * A plugin's view of a file: a single rendered view (added / deleted, or a
 * differ result), or a rendered pair (a modified file handled by a renderer-only
 * plugin — each side rendered independently, doc 29 FR-29.10).
 */
export type PluginFileView =
  | { kind: 'single'; view: RenderedView }
  | { kind: 'pair'; old: RenderedView | null; new: RenderedView | null };

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

export async function renderFileWithPlugins(
  mode: ReviewMode | null,
  diff: FileDiff,
  cwd: string,
): Promise<PluginFileView | null> {
  // Cheap gates first: nothing read unless a plugin might handle this path.
  if (!pluginsEnabled() || mode === null || diff.isBinary) return null;
  const path = diff.filePath;
  if (!mightHandleFile(path)) return null;
  const oldPath = diff.oldPath ?? path;

  if (diff.status === 'deleted') {
    const text = getModeFileContent(mode, oldPath, 'old', cwd);
    const view = await renderContent({ bytes: enc(text), text, path: oldPath, side: 'old' });
    return view !== null ? { kind: 'single', view } : null;
  }
  if (diff.status === 'added') {
    const text = getModeFileContent(mode, path, 'new', cwd);
    const view = await renderContent({ bytes: enc(text), text, path, side: 'new' });
    return view !== null ? { kind: 'single', view } : null;
  }

  // Modified (or renamed): prefer a differ; else render each side with a renderer.
  const oldText = getModeFileContent(mode, oldPath, 'old', cwd);
  const newText = getModeFileContent(mode, path, 'new', cwd);
  const oldIn = { bytes: enc(oldText), text: oldText, path: oldPath, side: 'old' as const };
  const newIn = { bytes: enc(newText), text: newText, path, side: 'new' as const };

  const diffed = await diffContent({ old: oldIn, new: newIn });
  if (diffed !== null) return { kind: 'single', view: diffed };

  const oldView = await renderContent(oldIn);
  const newView = await renderContent(newIn);
  if (oldView !== null || newView !== null) return { kind: 'pair', old: oldView, new: newView };
  return null;
}
