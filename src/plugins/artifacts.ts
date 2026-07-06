/**
 * Content-plugin integration for review-note artifacts (doc 29 FR-29.2 /
 * FR-29.13; doc 20 §20.5). Given the loaded notes for a file, ask the plugin
 * dispatcher to render each text/diagram-source artifact; a match attaches
 * inert rendered output (`renderedSvg` / `renderedHtml`) to the artifact view,
 * which `DiffView` shows in place of the raw code block. No match (the default,
 * with no plugin installed) leaves the artifact untouched — the code-block
 * fallback is unchanged (FR-29.14, NFR-29.3).
 */
import type { ReviewNoteView } from '../review-notes/view.js';
import { renderContent } from './index.js';

/**
 * Enrich a file's review-note artifacts with plugin-rendered output, in place.
 * Only text artifacts (those with inline `content`, not images) are offered to
 * the dispatcher. Returns the same array for call-site convenience.
 */
export async function renderNoteArtifacts(views: ReviewNoteView[]): Promise<ReviewNoteView[]> {
  for (const view of views) {
    for (const artifact of view.artifacts ?? []) {
      if (artifact.isImage === true || artifact.content === undefined) continue;
      const rendered = await renderContent({
        bytes: new TextEncoder().encode(artifact.content),
        text: artifact.content,
        path: artifact.uri,
      });
      if (rendered === null) continue;
      if (rendered.svg !== undefined && rendered.svg !== '') artifact.renderedSvg = rendered.svg;
      else if (rendered.html !== undefined && rendered.html !== '') artifact.renderedHtml = rendered.html;
    }
  }
  return views;
}
