import { attach } from 'kerfjs/attach';

import { ImageModeSchema, saveAIPreferences } from '../../../api/index.js';
import { asEl } from '../../dom.js';
import { diffViewStore } from '../../stores/index.js';
import { initImageFeedback } from './imageFeedback.js';
import { loadMetadata } from './metadata.js';
import { initSliceTool } from './sliceTool.js';
import { applyZoom, clampPan, notifyZoomChange, pickActualSize, setZoomState, zoomAt,type ZoomState } from './zoom.js';

/** Per-invocation state for one image-diff render, threaded through the
 *  module-scope helpers so they don't have to close over `bindImageDiff`'s
 *  locals. `ref` is the first (old) image layer used as the size reference. */
interface ImageDiffCtx {
  container: Element;
  sharedZoom: ZoomState;
  canvases: HTMLElement[];
  ref: HTMLImageElement;
  isVector: boolean;
}

/** Size one canvas's zoom-wrap to ITS OWN image's natural size. Difference/slice
 *  overlay old+new in one wrap (first layer is old = ref); side-by-side gives
 *  each pane its own image, so the new pane must size to the new image — not the
 *  old's — or a differently-shaped B image would be distorted (doc 24). */
function sizeWrap(ctx: ImageDiffCtx, canvas: HTMLElement): void {
  const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
  if (wrap === null) return;
  const ownImg = canvas.querySelector<HTMLImageElement>('.image-layer');
  let nw = ctx.ref.naturalWidth, nh = ctx.ref.naturalHeight;
  if (ownImg !== null && ownImg.naturalWidth > 0 && ownImg.naturalHeight > 0) {
    nw = ownImg.naturalWidth;
    nh = ownImg.naturalHeight;
  }
  if (!nw || !nh) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  const scale = Math.min(cw / nw, ch / nh);
  const fitW = Math.round(nw * scale);
  const fitH = Math.round(nh * scale);
  // Stamp the zoom=1 base size; the vector zoom path multiplies it by the zoom.
  wrap.dataset.zoomBaseW = String(fitW);
  wrap.dataset.zoomBaseH = String(fitH);
  wrap.style.width = `${fitW}px`;
  wrap.style.height = `${fitH}px`;
}

function applyToCanvas(ctx: ImageDiffCtx, canvas: HTMLElement): void {
  const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
  if (wrap === null) return;
  applyZoom(wrap, ctx.sharedZoom);
  // Show a grab affordance whenever the image is zoomed (and thus pannable).
  canvas.style.cursor = ctx.sharedZoom.zoom > 1 ? 'grab' : '';
  notifyZoomChange(canvas);
}

/** Re-apply the current zoom/pan to every currently-visible canvas. */
function applyToAll(ctx: ImageDiffCtx): void {
  for (const c of ctx.canvases) {
    if (c.offsetParent !== null) applyToCanvas(ctx, c);
  }
}

/** Re-fit + re-apply every visible canvas (after a layout change or image load). */
function syncVisible(ctx: ImageDiffCtx): void {
  for (const c of ctx.canvases) {
    if (c.offsetParent !== null) {
      sizeWrap(ctx, c);
      applyToCanvas(ctx, c);
    }
  }
}

function getVisibleCanvas(ctx: ImageDiffCtx): { canvas: HTMLElement; wrap: HTMLElement } | null {
  for (const c of ctx.canvases) {
    if (c.offsetParent !== null) {
      const wrap = c.querySelector<HTMLElement>('.image-zoom-wrap');
      if (wrap !== null) return { canvas: c, wrap };
    }
  }
  return null;
}

// The pan drag tracks the pointer at the `document` level (so a drag that leaves
// the canvas keeps panning). `bindImageDiff` re-runs on every image-file open,
// and the canvas elements live under `data-morph-skip` (replaced wholesale on a
// file switch), so their own `wheel`/`mousedown` listeners are GC'd with them —
// but the `document` listeners are NOT, so registering them per-canvas in a loop
// leaked one pair per canvas per open (the GB-800 retention class). They're now
// registered ONCE per invocation and the previous invocation's pair is removed
// first via this disposer.
let disposePan: (() => void) | null = null;

/** Wire zoom (wheel) per canvas and a single shared pan drag at the document
 *  level. Replaces any pan listeners left by a prior `bindImageDiff` call. */
function wireZoomAndPan(ctx: ImageDiffCtx): void {
  disposePan?.();
  disposePan = null;

  // Shared pan-drag state for the single document-level handlers below.
  let panning = false;
  let active: { canvas: HTMLElement; wrap: HTMLElement } | null = null;
  let startX = 0, startY = 0, baseX = 0, baseY = 0;

  for (const canvas of ctx.canvases) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
    if (wrap === null) continue;

    setZoomState(canvas, ctx.sharedZoom);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // macOS-native trackpad mapping (GB-942): a pinch arrives as a wheel event
      // with ctrlKey set (also true for an explicit Ctrl/Cmd+wheel), so pinch =
      // zoom; a plain two-finger swipe is a wheel event without ctrlKey, so it
      // pans. Panning only does something once the image overflows (zoom > 1).
      if (e.ctrlKey) {
        zoomAt(ctx.sharedZoom, canvas, wrap, e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.1);
        applyToAll(ctx);
      } else if (ctx.sharedZoom.zoom > 1) {
        ctx.sharedZoom.panX -= e.deltaX;
        ctx.sharedZoom.panY -= e.deltaY;
        clampPan(ctx.sharedZoom, canvas, wrap);
        applyToAll(ctx);
      }
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const overflows = wrap.offsetWidth * ctx.sharedZoom.zoom > canvas.clientWidth || wrap.offsetHeight * ctx.sharedZoom.zoom > canvas.clientHeight;
      if (!overflows && ctx.sharedZoom.zoom <= 1) return;
      panning = true;
      active = { canvas, wrap };
      startX = e.clientX; startY = e.clientY;
      baseX = ctx.sharedZoom.panX; baseY = ctx.sharedZoom.panY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });
  }

  const onMove = (e: MouseEvent) => {
    if (!panning || active === null) return;
    ctx.sharedZoom.panX = baseX + (e.clientX - startX);
    ctx.sharedZoom.panY = baseY + (e.clientY - startY);
    clampPan(ctx.sharedZoom, active.canvas, active.wrap);
    applyToAll(ctx);
  };
  const onUp = () => {
    if (!panning) return;
    panning = false;
    if (active !== null) active.canvas.style.cursor = ctx.sharedZoom.zoom > 1 ? 'grab' : '';
    active = null;
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  disposePan = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
}

/** Wire the image-toolbar buttons: visual-mode switch, side-by-side orientation,
 *  and the zoom in/out/fit/actual-size actions. */
function wireToolbar(ctx: ImageDiffCtx, imageToolbar: Element | null): void {
  imageToolbar?.querySelectorAll('[data-image-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = asEl(btn).dataset.imageMode ?? '';
      diffViewStore.actions.update({ lastImageMode: mode });
      const imageModeParsed = ImageModeSchema.safeParse(mode);
      if (imageModeParsed.success) {
        void saveAIPreferences({ last_image_mode: imageModeParsed.data });
      }
      imageToolbar.querySelectorAll('[data-image-mode]').forEach(b => b.classList.toggle('active', b === btn));
      ctx.container.querySelectorAll('.image-diff-panel').forEach(p =>
        p.classList.toggle('active', asEl(p).dataset.panel === mode));
      requestAnimationFrame(() => { syncVisible(ctx); });
    });
  });

  // Side-by-side orientation sub-control (doc 24): flip left-right vs over-under.
  // The store update drives the active-class + panel-attribute swap reactively
  // (see setupImageModeEffect); we re-fit here because the layout flip changes
  // how much space each pane gets.
  imageToolbar?.querySelectorAll('[data-sxs-orient]').forEach(btn => {
    btn.addEventListener('click', () => {
      const orient = asEl(btn).dataset.sxsOrient === 'over-under' ? 'over-under' : 'left-right';
      diffViewStore.actions.update({ sxsOrientation: orient });
      void saveAIPreferences({ image_sxs_orientation: orient });
      requestAnimationFrame(() => { syncVisible(ctx); });
    });
  });

  imageToolbar?.querySelectorAll<HTMLElement>('[data-zoom-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const vis = getVisibleCanvas(ctx);
      if (!vis) return;
      const action = btn.dataset.zoomAction;
      const rect = vis.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (action === 'in') {
        zoomAt(ctx.sharedZoom, vis.canvas, vis.wrap, cx, cy, 1.4);
      } else if (action === 'out') {
        zoomAt(ctx.sharedZoom, vis.canvas, vis.wrap, cx, cy, 0.7);
      } else if (action === 'fit') {
        ctx.sharedZoom.zoom = 1; ctx.sharedZoom.panX = 0; ctx.sharedZoom.panY = 0;
        syncVisible(ctx);
      } else if (action === 'actual') {
        applyActualSize(ctx);
      }
      applyToAll(ctx);
    });
  });
}

/** "Actual size" makes EVERY visible canvas 1:1 — in side-by-side both panes go
 *  to their own natural size, not just the first (GB-951). */
function applyActualSize(ctx: ImageDiffCtx): void {
  const bw = parseInt(asEl(ctx.container).dataset.baseWidth ?? '', 10);
  const bh = parseInt(asEl(ctx.container).dataset.baseHeight ?? '', 10);
  let appliedAny = false;
  for (const c of ctx.canvases) {
    if (c.offsetParent === null) continue;
    const wrap = c.querySelector<HTMLElement>('.image-zoom-wrap');
    if (wrap === null) continue;
    const img = c.querySelector<HTMLImageElement>('.image-layer');
    const size = pickActualSize({
      perPane: c.closest('[data-sxs-pane]') !== null,
      imgNatural: { w: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0 },
      base: { w: bw, h: bh },
    });
    if (size === null) continue;
    // For a vector wrap, the base size drives applyZoom — set it to the natural
    // size so "actual size" maps zoom = 1 to 1:1 pixels.
    if (ctx.isVector) {
      wrap.dataset.zoomBaseW = String(size.w);
      wrap.dataset.zoomBaseH = String(size.h);
    }
    wrap.style.width = `${size.w}px`;
    wrap.style.height = `${size.h}px`;
    appliedAny = true;
  }
  if (appliedAny) { ctx.sharedZoom.zoom = 1; ctx.sharedZoom.panX = 0; ctx.sharedZoom.panY = 0; }
}

export function bindImageDiff(): void {
  const container = document.querySelector('.image-diff');
  if (!container) return;

  const fileId = asEl(container).dataset.fileId ?? '';
  const hasOld = asEl(container).dataset.hasOld === 'true';
  const hasNew = asEl(container).dataset.hasNew === 'true';
  const hasComparison = hasOld && hasNew;

  // SVG rendered views zoom as vectors: the wrapper grows its layout size with
  // zoom so the browser re-rasterizes the SVG crisply, rather than magnifying a
  // fixed bitmap via transform: scale() (GB-941). Raster images keep the scale
  // path. The `.diff-view` ancestor carries `data-is-svg` for the rendered view.
  const isVector = container.closest('.diff-view')?.getAttribute('data-is-svg') === 'true';

  void loadMetadata(fileId, container);

  const canvases = Array.from(container.querySelectorAll<HTMLElement>('.image-visual-canvas'));
  if (isVector) {
    for (const c of canvases) {
      const w = c.querySelector<HTMLElement>('.image-zoom-wrap');
      if (w !== null) w.dataset.vectorZoom = 'true';
    }
  }

  const refImg = container.querySelector<HTMLImageElement>('.image-layer-old');
  if (refImg === null) return;

  // Shared zoom/pan state across all visual modes.
  const ctx: ImageDiffCtx = {
    container,
    sharedZoom: { zoom: 1, panX: 0, panY: 0 },
    canvases,
    ref: refImg,
    isVector,
  };

  const onImageReady = () => { syncVisible(ctx); };
  if (refImg.complete && refImg.naturalWidth > 0) onImageReady();
  else refImg.addEventListener('load', onImageReady);

  // Side-by-side has a second image (the new pane) whose natural size drives its
  // own pane; re-fit when any image finishes loading (doc 24).
  for (const img of Array.from(container.querySelectorAll<HTMLImageElement>('.image-layer'))) {
    if (img.complete && img.naturalWidth > 0) continue;
    img.addEventListener('load', () => { syncVisible(ctx); });
  }

  new ResizeObserver(() => {
    for (const c of canvases) {
      if (c.offsetParent !== null) {
        sizeWrap(ctx, c);
        const wrap = c.querySelector<HTMLElement>('.image-zoom-wrap');
        if (wrap !== null) clampPan(ctx.sharedZoom, c, wrap);
        applyToCanvas(ctx, c);
      }
    }
  }).observe(container);

  const imageToolbar = document.querySelector('.diff-toolbar-image');
  wireZoomAndPan(ctx);
  wireToolbar(ctx, imageToolbar);

  if (hasComparison) {
    const sliceCanvas = container.querySelector('[data-panel="slice"] .image-visual-canvas');
    // Bind the slice tool's lifecycle to its canvas (kerfjs/attach): its setup
    // adds document-level drag listeners + a ResizeObserver, and the returned
    // teardown drops them when the canvas leaves the DOM — which the diff-pane
    // `remountOn` triggers on every file switch, so they no longer accumulate.
    if (sliceCanvas) attach(sliceCanvas, () => initSliceTool(sliceCanvas));
  }

  // Image feedback (doc 23): general comments + drawn rectangle regions.
  initImageFeedback(asEl(container));
}
