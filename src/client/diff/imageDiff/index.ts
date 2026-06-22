import { ImageModeSchema, saveAIPreferences } from '../../../api/index.js';
import { asEl } from '../../dom.js';
import { diffViewStore } from '../../stores/index.js';
import { initImageFeedback } from './imageFeedback.js';
import { loadMetadata } from './metadata.js';
import { initSliceTool } from './sliceTool.js';
import { applyZoom, clampPan, notifyZoomChange, pickActualSize, setZoomState, zoomAt,type ZoomState } from './zoom.js';

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

  // Shared zoom/pan state across all visual modes
  const sharedZoom: ZoomState = { zoom: 1, panX: 0, panY: 0 };

  const canvases = Array.from(container.querySelectorAll<HTMLElement>('.image-visual-canvas'));
  if (isVector) {
    for (const c of canvases) {
      const w = c.querySelector<HTMLElement>('.image-zoom-wrap');
      if (w !== null) w.dataset.vectorZoom = 'true';
    }
  }

  const refImg = container.querySelector<HTMLImageElement>('.image-layer-old');
  if (refImg === null) return;
  const ref = refImg;

  function sizeWrap(canvas: HTMLElement) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
    if (wrap === null) return;
    // Size each canvas's wrap to ITS OWN image's natural size. Difference/slice
    // overlay old+new in one wrap (first layer is old = ref); side-by-side gives
    // each pane its own image, so the new pane must size to the new image — not
    // the old's — or a differently-shaped B image would be distorted (doc 24).
    const ownImg = canvas.querySelector<HTMLImageElement>('.image-layer');
    let nw = ref.naturalWidth, nh = ref.naturalHeight;
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

  function applyToCanvas(canvas: HTMLElement) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
    if (wrap === null) return;
    applyZoom(wrap, sharedZoom);
    // Show a grab affordance whenever the image is zoomed (and thus pannable).
    canvas.style.cursor = sharedZoom.zoom > 1 ? 'grab' : '';
    notifyZoomChange(canvas);
  }

  function applyToAll() {
    for (const c of canvases) {
      if (c.offsetParent !== null) applyToCanvas(c);
    }
  }

  function syncVisible() {
    for (const c of canvases) {
      if (c.offsetParent !== null) {
        sizeWrap(c);
        applyToCanvas(c);
      }
    }
  }

  function onImageReady() { syncVisible(); }
  if (refImg.complete && refImg.naturalWidth > 0) onImageReady();
  else refImg.addEventListener('load', onImageReady);

  // Side-by-side has a second image (the new pane) whose natural size drives its
  // own pane; re-fit when any image finishes loading (doc 24).
  for (const img of Array.from(container.querySelectorAll<HTMLImageElement>('.image-layer'))) {
    if (img.complete && img.naturalWidth > 0) continue;
    img.addEventListener('load', () => { syncVisible(); });
  }

  new ResizeObserver(() => {
    for (const c of canvases) {
      if (c.offsetParent !== null) {
        sizeWrap(c);
        const wrap = c.querySelector<HTMLElement>('.image-zoom-wrap');
        if (wrap !== null) clampPan(sharedZoom, c, wrap);
        applyToCanvas(c);
      }
    }
  }).observe(container);

  const imageToolbar = document.querySelector('.diff-toolbar-image');

  imageToolbar?.querySelectorAll('[data-image-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = asEl(btn).dataset.imageMode ?? '';
      diffViewStore.actions.update({ lastImageMode: mode });
      const imageModeParsed = ImageModeSchema.safeParse(mode);
      if (imageModeParsed.success) {
        void saveAIPreferences({ last_image_mode: imageModeParsed.data });
      }
      imageToolbar.querySelectorAll('[data-image-mode]').forEach(b => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.image-diff-panel').forEach(p =>
        p.classList.toggle('active', asEl(p).dataset.panel === mode));
      requestAnimationFrame(() => { syncVisible(); });
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
      requestAnimationFrame(() => { syncVisible(); });
    });
  });

  function getVisibleCanvas(): { canvas: HTMLElement; wrap: HTMLElement } | null {
    for (const c of canvases) {
      if (c.offsetParent !== null) {
        const wrap = c.querySelector<HTMLElement>('.image-zoom-wrap');
        if (wrap !== null) return { canvas: c, wrap };
      }
    }
    return null;
  }

  // Wire zoom + pan on each canvas
  for (const canvas of canvases) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
    if (wrap === null) continue;

    setZoomState(canvas, sharedZoom);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // macOS-native trackpad mapping (GB-942): a pinch arrives as a wheel event
      // with ctrlKey set (also true for an explicit Ctrl/Cmd+wheel), so pinch =
      // zoom; a plain two-finger swipe is a wheel event without ctrlKey, so it
      // pans. Panning only does something once the image overflows (zoom > 1).
      if (e.ctrlKey) {
        zoomAt(sharedZoom, canvas, wrap, e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.1);
        applyToAll();
      } else if (sharedZoom.zoom > 1) {
        sharedZoom.panX -= e.deltaX;
        sharedZoom.panY -= e.deltaY;
        clampPan(sharedZoom, canvas, wrap);
        applyToAll();
      }
    }, { passive: false });

    let panning = false;
    let startX = 0, startY = 0, baseX = 0, baseY = 0;
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const overflows = wrap.offsetWidth * sharedZoom.zoom > canvas.clientWidth || wrap.offsetHeight * sharedZoom.zoom > canvas.clientHeight;
      if (!overflows && sharedZoom.zoom <= 1) return;
      panning = true;
      startX = e.clientX; startY = e.clientY;
      baseX = sharedZoom.panX; baseY = sharedZoom.panY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!panning) return;
      sharedZoom.panX = baseX + (e.clientX - startX);
      sharedZoom.panY = baseY + (e.clientY - startY);
      clampPan(sharedZoom, canvas, wrap);
      applyToAll();
    });
    document.addEventListener('mouseup', () => {
      if (!panning) return;
      panning = false;
      canvas.style.cursor = sharedZoom.zoom > 1 ? 'grab' : '';
    });
  }

  imageToolbar?.querySelectorAll<HTMLElement>('[data-zoom-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const vis = getVisibleCanvas();
      if (!vis) return;
      const action = btn.dataset.zoomAction;
      const rect = vis.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (action === 'in') {
        zoomAt(sharedZoom, vis.canvas, vis.wrap, cx, cy, 1.4);
      } else if (action === 'out') {
        zoomAt(sharedZoom, vis.canvas, vis.wrap, cx, cy, 0.7);
      } else if (action === 'fit') {
        sharedZoom.zoom = 1; sharedZoom.panX = 0; sharedZoom.panY = 0;
        syncVisible();
      } else if (action === 'actual') {
        // "Actual size" makes EVERY visible canvas 1:1 — in side-by-side both
        // panes go to their own natural size, not just the first (GB-951).
        const bw = parseInt(asEl(container).dataset.baseWidth ?? '', 10);
        const bh = parseInt(asEl(container).dataset.baseHeight ?? '', 10);
        let appliedAny = false;
        for (const c of canvases) {
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
          // For a vector wrap, the base size drives applyZoom — set it to the
          // natural size so "actual size" maps zoom = 1 to 1:1 pixels.
          if (isVector) {
            wrap.dataset.zoomBaseW = String(size.w);
            wrap.dataset.zoomBaseH = String(size.h);
          }
          wrap.style.width = `${size.w}px`;
          wrap.style.height = `${size.h}px`;
          appliedAny = true;
        }
        if (appliedAny) { sharedZoom.zoom = 1; sharedZoom.panX = 0; sharedZoom.panY = 0; }
      }
      applyToAll();
    });
  });

  if (hasComparison) {
    const sliceCanvas = container.querySelector('[data-panel="slice"] .image-visual-canvas');
    if (sliceCanvas) initSliceTool(sliceCanvas);
  }

  // Image feedback (doc 23): general comments + drawn rectangle regions.
  initImageFeedback(asEl(container));
}
