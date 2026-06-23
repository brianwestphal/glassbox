import { delegate } from 'kerfjs';

import type { ImageRegion } from '../../api/index.js';
import { asEl, toElement } from '../dom.js';
import { openLightbox } from '../lightbox.js';
import { editFormSignal } from '../stores/index.js';
import { clientToFraction, isDrawnRegion, rectFromPoints, regionStyle } from './imageDiff/regionGeometry.js';

/**
 * Mark regions on an AI review note's image artifact (doc 20 §20.5) and carry
 * them into a reply (doc 25 / GB-953, GB-959). Two ways to mark:
 *
 * - **Inline** — drag a rectangle directly on the inline `.ai-note-artifact-img`
 *   thumbnail. A plain click (no drag) opens the full-screen lightbox.
 * - **Full screen** — click to open the shared lightbox and drag there.
 *
 * Either way the rectangle is held pending against the note's guid; a reply can
 * carry several. Opening the note's reply form (auto-opened on the first mark)
 * and saving consumes them so the reply shows the marked thumbnail(s).
 */

// Note guid -> the regions marked on its artifact(s), awaiting a reply.
const pending = new Map<string, ImageRegion[]>();

/** Consume every region marked for `guid` (clearing the inline overlays). Called
 *  by the reply form on save. */
export function takePendingArtifactRegions(guid: string): ImageRegion[] {
  const regions = pending.get(guid) ?? [];
  pending.delete(guid);
  clearArtifactOverlays(guid);
  return regions;
}

/** Drop any pending regions for `guid` (e.g. the reply was canceled). */
export function clearPendingArtifactRegions(guid: string): void {
  if (!pending.has(guid)) return;
  pending.delete(guid);
  clearArtifactOverlays(guid);
}

function addPending(guid: string, region: ImageRegion): void {
  const list = pending.get(guid) ?? [];
  list.push(region);
  pending.set(guid, list);
}

/** Every inline overlay layer that belongs to the note with this guid. */
function artifactOverlaysFor(guid: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.ai-note-artifact-region-overlay'))
    .filter(o => o.closest<HTMLElement>('.ai-note-row')?.dataset.noteId === guid);
}

/** Redraw the inline overlay boxes for a note from its pending regions. */
function redrawArtifactOverlays(guid: string): void {
  const regions = pending.get(guid) ?? [];
  for (const overlay of artifactOverlaysFor(guid)) {
    const uri = overlay.dataset.artifactUri ?? '';
    const boxes = regions
      .filter(r => r.artifact === uri)
      .map(r => {
        const s = regionStyle(r);
        return toElement(
          <div className="ai-note-artifact-region-box"
            style={`left:${s.left};top:${s.top};width:${s.width};height:${s.height}`}></div>,
        );
      });
    overlay.replaceChildren(...boxes);
  }
}

function clearArtifactOverlays(guid: string): void {
  for (const overlay of artifactOverlaysFor(guid)) overlay.replaceChildren();
}

/** Open the note's reply form unless it is already open for this note (so we
 *  never wipe a reply the reviewer has started typing). */
function openReplyFormIfNeeded(guid: string, noteRow: HTMLElement | null): void {
  if (editFormSignal.value?.replyToNoteId === guid) return;
  noteRow?.querySelector<HTMLElement>('.ai-note-reply-btn')?.click();
}

/** Record a freshly-marked region against the note and surface its reply form. */
function markArtifactRegion(guid: string, uri: string, region: ImageRegion, noteRow: HTMLElement | null): void {
  addPending(guid, { ...region, artifact: uri });
  redrawArtifactOverlays(guid);
  openReplyFormIfNeeded(guid, noteRow);
}

function openArtifactLightbox(img: HTMLElement, uri: string, guid: string, noteRow: HTMLElement | null): void {
  const src = img.getAttribute('src') ?? '';
  if (src === '') return;
  const drawable = guid !== '' && uri !== '';
  openLightbox({
    src,
    alt: uri,
    onRegion: drawable ? (region: ImageRegion) => { markArtifactRegion(guid, uri, region, noteRow); } : undefined,
  });
}

export function bindNoteArtifactRegions(root: HTMLElement): void {
  void delegate(root, 'mousedown', '.ai-note-artifact-img', (e, img) => {
    const me = e as MouseEvent;
    if (me.button !== 0) return;
    const el = asEl(img);
    const uri = el.dataset.artifactUri ?? '';
    const noteRow = el.closest<HTMLElement>('.ai-note-row');
    const guid = noteRow?.dataset.noteId ?? '';
    // Only notes with a guid + artifact uri can be replied to; otherwise the
    // image is preview-only and a click just opens the lightbox.
    const drawable = guid !== '' && uri !== '';
    const overlay = el.parentElement?.querySelector<HTMLElement>('.ai-note-artifact-region-overlay') ?? null;
    const canDraw = drawable && overlay !== null;

    me.preventDefault();
    const rect = el.getBoundingClientRect();
    const start = clientToFraction(rect, me.clientX, me.clientY);
    let drawn: ImageRegion = { x: start.x, y: start.y, w: 0, h: 0 };

    const tempBox = canDraw ? toElement(<div className="ai-note-artifact-region-box"></div>) : null;
    if (tempBox !== null && overlay !== null) overlay.appendChild(tempBox);

    const onMove = (ev: MouseEvent) => {
      drawn = rectFromPoints(start, clientToFraction(rect, ev.clientX, ev.clientY));
      if (tempBox !== null) {
        const s = regionStyle(drawn);
        tempBox.style.cssText = `left:${s.left};top:${s.top};width:${s.width};height:${s.height}`;
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (canDraw && isDrawnRegion(drawn)) {
        // A real drag: keep the mark and open the reply form.
        markArtifactRegion(guid, uri, drawn, noteRow);
      } else {
        // A click (or no draw possible): drop the temp box and go full-screen.
        if (guid !== '') redrawArtifactOverlays(guid);
        openArtifactLightbox(el, uri, guid, noteRow);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
