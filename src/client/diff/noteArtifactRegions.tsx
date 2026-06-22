import { delegate } from 'kerfjs';

import type { ImageRegion } from '../../api/index.js';
import { asEl } from '../dom.js';
import { openLightbox } from '../lightbox.js';

/**
 * Click an AI review note's image artifact (doc 20 §20.5) to open it in the
 * shared full-screen lightbox, and drag a rectangle to mark a region. The marked
 * region is held pending against the note's guid; opening that note's reply form
 * consumes it so the reply carries a "see this spot" marked thumbnail
 * (doc 25 / GB-953).
 */

const pending = new Map<string, ImageRegion>();

/** Consume the region marked for `guid` (if any). Called by the reply form on save. */
export function takePendingArtifactRegion(guid: string): ImageRegion | undefined {
  const region = pending.get(guid);
  if (region !== undefined) pending.delete(guid);
  return region;
}

export function bindNoteArtifactRegions(root: HTMLElement): void {
  void delegate(root, 'click', '.ai-note-artifact-img', (_e, img) => {
    const el = asEl(img);
    const src = el.getAttribute('src') ?? '';
    if (src === '') return;
    const uri = el.dataset.artifactUri ?? '';
    const noteRow = el.closest<HTMLElement>('.ai-note-row');
    const guid = noteRow?.dataset.noteId ?? '';
    // Only notes with a guid can be replied to; without one we just preview.
    const drawable = guid !== '' && uri !== '';
    openLightbox({
      src,
      alt: uri,
      onRegion: drawable
        ? (region: ImageRegion) => {
            pending.set(guid, { ...region, artifact: uri });
            // Open the note's reply form so the region rides along on save.
            noteRow?.querySelector<HTMLElement>('.ai-note-reply-btn')?.click();
          }
        : undefined,
    });
  });
}
