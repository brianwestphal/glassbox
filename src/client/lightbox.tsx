import type { ImageRegion } from '../api/index.js';
import { IconX } from '../icons.js';
import { clientToFraction, isDrawnRegion, rectFromPoints, regionStyle } from './diff/imageDiff/regionGeometry.js';
import { toElement } from './dom.js';

/**
 * Shared full-screen lightbox (doc 25 / GB-953). Used to preview note image
 * artifacts and, optionally, to drag a rectangle on the image to mark a region
 * (normalized `{x,y,w,h}`, doc 23's model). One instance at a time; Esc, the
 * close button, or a backdrop click dismisses it.
 *
 * Built to be reusable: attachment image previews and image-file diffs can adopt
 * it later. The region-draw layer is opt-in via `onRegion`.
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
  const drawable = opts.kind !== 'pdf' && opts.onRegion !== undefined;

  const media = opts.kind === 'pdf'
    ? <iframe className="lightbox-pdf" src={opts.src} title={opts.alt ?? 'attachment'}></iframe>
    : <img className="lightbox-img" src={opts.src} alt={opts.alt ?? ''} draggable={false} />;

  const overlay = toElement(
    <div className="lightbox-overlay" role="dialog" aria-label={opts.alt ?? 'Preview'}>
      <button className="lightbox-close" aria-label="Close"><IconX /></button>
      <div className={`lightbox-frame${drawable ? ' lightbox-drawable' : ''}`}>
        {media}
        <div className="lightbox-region-overlay"></div>
      </div>
      {drawable ? <div className="lightbox-hint">Drag a rectangle to mark a region for your reply</div> : null}
    </div>,
  );

  // Backdrop click closes; clicks on the frame/controls don't.
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeLightbox();
  });
  overlay.querySelector('.lightbox-close')?.addEventListener('click', () => { closeLightbox(); });

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
