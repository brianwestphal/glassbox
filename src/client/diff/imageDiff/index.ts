import { api } from '../../api.js';
import { diffViewStore } from '../../stores/index.js';
import { loadMetadata } from './metadata.js';
import { initSliceTool } from './sliceTool.js';
import { applyZoom, clampPan, notifyZoomChange, setZoomState, zoomAt,type ZoomState } from './zoom.js';

export function bindImageDiff(): void {
  const container = document.querySelector('.image-diff');
  if (!container) return;

  const fileId = (container as HTMLElement).dataset.fileId ?? '';
  const hasOld = (container as HTMLElement).dataset.hasOld === 'true';
  const hasNew = (container as HTMLElement).dataset.hasNew === 'true';
  const hasComparison = hasOld && hasNew;

  void loadMetadata(fileId, container);

  // Shared zoom/pan state across all visual modes
  const sharedZoom: ZoomState = { zoom: 1, panX: 0, panY: 0 };

  const canvases = Array.from(container.querySelectorAll<HTMLElement>('.image-visual-canvas'));

  const refImg = container.querySelector<HTMLImageElement>('.image-layer-old');
  if (refImg === null) return;
  const ref = refImg;

  function sizeWrap(canvas: HTMLElement) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
    if (wrap === null) return;
    const nw = ref.naturalWidth, nh = ref.naturalHeight;
    if (!nw || !nh) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const scale = Math.min(cw / nw, ch / nh);
    wrap.style.width = `${Math.round(nw * scale)}px`;
    wrap.style.height = `${Math.round(nh * scale)}px`;
  }

  function applyToCanvas(canvas: HTMLElement) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
    if (wrap === null) return;
    applyZoom(wrap, sharedZoom);
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
      const mode = (btn as HTMLElement).dataset.imageMode ?? '';
      diffViewStore.actions.update({ lastImageMode: mode });
      void api('/ai/preferences', { method: 'POST', body: { last_image_mode: mode } });
      imageToolbar.querySelectorAll('[data-image-mode]').forEach(b => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.image-diff-panel').forEach(p =>
        p.classList.toggle('active', (p as HTMLElement).dataset.panel === mode));
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
      zoomAt(sharedZoom, canvas, wrap, e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.1);
      applyToAll();
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
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!panning) return;
      sharedZoom.panX = baseX + (e.clientX - startX);
      sharedZoom.panY = baseY + (e.clientY - startY);
      clampPan(sharedZoom, canvas, wrap);
      applyToAll();
    });
    document.addEventListener('mouseup', () => { panning = false; });
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
        const bw = parseInt((container as HTMLElement).dataset.baseWidth ?? '', 10);
        const bh = parseInt((container as HTMLElement).dataset.baseHeight ?? '', 10);
        const nw = (bw > 0 && bh > 0) ? bw : refImg.naturalWidth;
        const nh = (bw > 0 && bh > 0) ? bh : refImg.naturalHeight;
        if (nw > 0 && nh > 0) {
          vis.wrap.style.width = `${nw}px`;
          vis.wrap.style.height = `${nh}px`;
          sharedZoom.zoom = 1; sharedZoom.panX = 0; sharedZoom.panY = 0;
        }
      }
      applyToAll();
    });
  });

  if (hasComparison) {
    const sliceCanvas = container.querySelector('[data-panel="slice"] .image-visual-canvas');
    if (sliceCanvas) initSliceTool(sliceCanvas);
  }
}
