/**
 * Content-plugin integration for the file diff viewer (doc 29 FR-29.2, GB-1042 /
 * GB-1052). A file a plugin renders to SVG (e.g. a `.dot` Graphviz source) is
 * treated like an SVG file: it gets the **Code | Rendered** toggle, and in the
 * Rendered view its per-side SVG flows into the existing image viewer, so zoom
 * and every comparison mode (A / B / Side-by-Side / Difference / Slice) apply
 * unchanged.
 *
 * This module renders one side's SVG on demand; the image route
 * (`GET /api/image/:fileId/:side`) serves it, and the `/file/:id` rendered branch
 * uses it to size the viewer. No blob storage — the render is cheap and cached
 * (the plugin owns its WASM instance).
 */
import { getModeFileContent } from '../git/diff.js';
import type { ReviewMode } from '../git/types.js';
import { mightHandleFile, pluginsEnabled, renderContent } from './index.js';

/**
 * Whether a content plugin handles this file path (cheap ext/MIME pre-check).
 * Drives the file-list flag + the Code/Rendered gate; `false` when the subsystem
 * is disabled.
 */
export function pluginRendersFile(filePath: string): boolean {
  return pluginsEnabled() && mightHandleFile(filePath);
}

/**
 * Render one side of a file to SVG via the best-matching plugin, or `null` if no
 * plugin renders it to SVG (empty source, HTML-only output, differ-only plugin).
 * `side` selects which content to read (old vs new); matching keys off `filePath`.
 */
export async function renderPluginSvgSide(
  mode: ReviewMode | null,
  filePath: string,
  oldPath: string,
  side: 'old' | 'new',
  cwd: string,
): Promise<string | null> {
  if (mode === null || !pluginRendersFile(filePath)) return null;
  const source = getModeFileContent(mode, side === 'old' ? oldPath : filePath, side, cwd);
  if (source.trim() === '') return null;
  const view = await renderContent({ bytes: new TextEncoder().encode(source), text: source, path: filePath, side });
  return view?.svg !== undefined && view.svg !== '' ? view.svg : null;
}
