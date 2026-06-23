import type { ImageRegion } from '../api/index.js';
import { IconX } from '../icons.js';
import { clientToFraction, isDrawnRegion, rectFromPoints, regionStyle } from './diff/imageDiff/regionGeometry.js';
import { toElement } from './dom.js';
import {
  clampPan,
  LIGHTBOX_MIN_ZOOM,
  type LightboxZoomState,
  resetZoom,
  zoomTowardCursor,
} from './lightboxZoom.js';

/**
 * Shared full-screen lightbox (doc 25 / GB-953). Used to preview note image
 * artifacts and attachment images and, optionally, to drag a rectangle on the
 * image to mark a region (normalized `{x,y,w,h}`, doc 23's model). One instance
 * at a time; Esc, the close button, or a backdrop click dismisses it.
 *
 * Images support zoom (wheel / pinch / the +/− controls) and pan (drag when not
 * drawing a region, or wheel/two-finger) so a reviewer can mark a precise region
 * on a large artifact (GB-963). Region fractions stay correct under any transform
 * because they're read from the overlay's live (post-transform) bounding rect.
 * The region-draw layer is opt-in via `onRegion`.
 */

interface LightboxOptions {
  src: string;
  alt?: string;
  /** A PDF renders in an iframe (no region draw); the default is an image. */
  kind?: 'image' | 'pdf';
  /** Enable drag-to-draw; called with the normalized region once a valid
   *  rectangle is drawn, after which the lightbox closes. */
  onRegion?: (region: ImageRegion) => void;
}

let openEl: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
const ZOOM_STEP = 1.25;

export function closeLightbox(): void {
  if (openEl === null) return;
  openEl.remove();
  openEl = null;
  if (escHandler !== null) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}

export function isLightboxOpen(): boolean {
  return openEl !== null;
}

export function openLightbox(opts: LightboxOptions): void {
  closeLightbox();
  const isImage = opts.kind !== 'pdf';
  const drawable = isImage && opts.onRegion !== undefined;

  const media = opts.kind === 'pdf'
    ? <iframe className="lightbox-pdf" src={opts.src} title={opts.alt ?? 'attachment'}></iframe>
    : <img className="lightbox-img" src={opts.src} alt={opts.alt ?? ''} draggable={false} />;

  const overlay = toElement(
    <div className="lightbox-overlay" role="dialog" aria-label={opts.alt ?? 'Preview'}>
      <button className="lightbox-close" aria-label="Close"><IconX /></button>
      <div className="lightbox-viewport">
        <div className={`lightbox-frame${drawable ? ' lightbox-drawable' : ''}`}>
          {media}
          <div className="lightbox-region-overlay"></div>
        </div>
      </div>
      {isImage ? (
        <div className="lightbox-controls" role="group" aria-label="Zoom">
          <button className="lightbox-zoom-btn" data-zoom="out" aria-label="Zoom out">&minus;</button>
          <button className="lightbox-zoom-btn lightbox-zoom-level" data-zoom="reset" aria-label="Reset zoom">100%</button>
          <button className="lightbox-zoom-btn" data-zoom="in" aria-label="Zoom in">+</button>
        </div>
      ) : null}
      {drawable ? <div className="lightbox-hint">Drag a rectangle to mark a region for your reply</div> : null}
    </div>,
  );

  // Backdrop click closes; clicks on the frame/controls don't.
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeLightbox();
  });
  overlay.querySelector('.lightbox-close')?.addEventListener('click', () => { closeLightbox(); });

  if (isImage) {
    wireZoomPan(overlay, drawable);
  }
  if (drawable && opts.onRegion !== undefined) {
    wireRegionDraw(overlay, opts.onRegion);
  }

  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
  };
  document.addEventListener('keydown', escHandler);

  document.body.appendChild(overlay);
  openEl = overlay;
}

/** Zoom (wheel / pinch / +−) and pan (drag when not drawing, or wheel) on the
 *  image frame, clipped to the viewport. Region fractions stay accurate because
 *  `wireRegionDraw` reads the overlay's live post-transform rect. */
function wireZoomPan(overlay: HTMLElement, drawable: boolean): void {
  const viewport = overlay.querySelector<HTMLElement>('.lightbox-viewport');
  const frame = overlay.querySelector<HTMLElement>('.lightbox-frame');
  const level = overlay.querySelector<HTMLElement>('.lightbox-zoom-level');
  if (viewport === null || frame === null) return;

  let state: LightboxZoomState = resetZoom();

  const apply = (): void => {
    state = clampPan(state, frame.offsetWidth, frame.offsetHeight, viewport.clientWidth, viewport.clientHeight);
    frame.style.transform = state.zoom <= LIGHTBOX_MIN_ZOOM
      ? ''
      : `translate(${String(state.panX)}px, ${String(state.panY)}px) scale(${String(state.zoom)})`;
    overlay.classList.toggle('lightbox-zoomed', state.zoom > LIGHTBOX_MIN_ZOOM);
    if (level !== null) level.textContent = `${String(Math.round(state.zoom * 100))}%`;
  };

  const zoomBy = (factor: number, clientX: number, clientY: number): void => {
    state = zoomTowardCursor(state, viewport.getBoundingClientRect(), clientX, clientY, factor);
    apply();
  };

  viewport.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    // ctrlKey is a pinch gesture (or Ctrl+wheel) → zoom; a plain wheel pans when
    // zoomed in. Mirrors the image-diff canvas split (GB-942).
    if (e.ctrlKey) {
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX, e.clientY);
    } else if (state.zoom > LIGHTBOX_MIN_ZOOM) {
      state = { zoom: state.zoom, panX: state.panX - e.deltaX, panY: state.panY - e.deltaY };
      apply();
    }
  }, { passive: false });

  viewport.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    // A click on the empty margin around the image closes (the viewport fills
    // most of the screen now, so the backdrop is mostly this element).
    if (e.target === viewport && state.zoom <= LIGHTBOX_MIN_ZOOM) { closeLightbox(); return; }
    // Region-draw mode owns frame drags; otherwise a drag pans a zoomed image.
    if (drawable || state.zoom <= LIGHTBOX_MIN_ZOOM) return;
    e.preventDefault();
    overlay.classList.add('lightbox-panning');
    const startX = e.clientX - state.panX;
    const startY = e.clientY - state.panY;
    const onMove = (ev: MouseEvent): void => {
      state = { zoom: state.zoom, panX: ev.clientX - startX, panY: ev.clientY - startY };
      apply();
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      overlay.classList.remove('lightbox-panning');
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  overlay.querySelectorAll<HTMLElement>('.lightbox-zoom-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rect = viewport.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const kind = btn.dataset.zoom;
      if (kind === 'in') zoomBy(ZOOM_STEP, cx, cy);
      else if (kind === 'out') zoomBy(1 / ZOOM_STEP, cx, cy);
      else { state = resetZoom(); apply(); }
    });
  });
}

/** Drag-to-draw a single rectangle over the lightbox image; on a valid release,
 *  hand the normalized region to `onRegion` and close. */
function wireRegionDraw(overlay: HTMLElement, onRegion: (region: ImageRegion) => void): void {
  const frame = overlay.querySelector<HTMLElement>('.lightbox-frame');
  const region = overlay.querySelector<HTMLElement>('.lightbox-region-overlay');
  if (frame === null || region === null) return;

  frame.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = region.getBoundingClientRect();
    const start = clientToFraction(rect, e.clientX, e.clientY);
    let drawn: ImageRegion = { x: start.x, y: start.y, w: 0, h: 0 };

    const box = toElement(<div className="lightbox-region-box"></div>);
    region.replaceChildren(box);

    const onMove = (ev: MouseEvent) => {
      drawn = rectFromPoints(start, clientToFraction(rect, ev.clientX, ev.clientY));
      const s = regionStyle(drawn);
      box.style.cssText = `left:${s.left};top:${s.top};width:${s.width};height:${s.height}`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (isDrawnRegion(drawn)) {
        onRegion(drawn);
        closeLightbox();
      } else {
        region.replaceChildren();
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
