import { api } from '../api.js';
import { state } from '../state.js';

// --- Public entry ---

export function bindImageDiff() {
  const container = document.querySelector('.image-diff');
  if (!container) return;

  const fileId = (container as HTMLElement).dataset.fileId ?? '';
  const hasOld = (container as HTMLElement).dataset.hasOld === 'true';
  const hasNew = (container as HTMLElement).dataset.hasNew === 'true';

  const hasComparison = hasOld && hasNew;

  loadMetadata(fileId, container);

  // Shared zoom/pan state across all visual modes
  const sharedZoom: ZoomState = { zoom: 1, panX: 0, panY: 0 };
  let userHasZoomed = false;

  // Collect all visual canvases
  const canvases = Array.from(container.querySelectorAll<HTMLElement>('.image-visual-canvas'));

  // Get the reference image (any canvas — they all load the same image)
  const refImg = container.querySelector<HTMLImageElement>('.image-layer-old')!;

  /** Size a canvas's wrapper to fit the image, preserving zoom/pan. */
  function sizeWrap(canvas: HTMLElement) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap')!;
    const nw = refImg.naturalWidth, nh = refImg.naturalHeight;
    if (!nw || !nh) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const scale = Math.min(cw / nw, ch / nh);
    wrap.style.width = `${Math.round(nw * scale)}px`;
    wrap.style.height = `${Math.round(nh * scale)}px`;
  }

  /** Apply shared zoom state to a canvas's wrapper. */
  function applyToCanvas(canvas: HTMLElement) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap')!;
    applyZoom(wrap, sharedZoom);
    // Notify slice tool if registered
    (canvas as any)._onZoomChange?.();
  }

  /** Apply zoom to all visible canvases. */
  function applyToAll() {
    for (const c of canvases) {
      if (c.offsetParent !== null) applyToCanvas(c);
    }
  }

  /** Size wrapper and apply zoom for all visible canvases. */
  function syncVisible() {
    for (const c of canvases) {
      if (c.offsetParent !== null) {
        sizeWrap(c);
        applyToCanvas(c);
      }
    }
  }

  // Initial sizing
  function onImageReady() {
    syncVisible();
  }
  if (refImg.complete && refImg.naturalWidth > 0) onImageReady();
  else refImg.addEventListener('load', onImageReady);

  // On resize: re-size wrappers but preserve zoom/pan
  new ResizeObserver(() => {
    for (const c of canvases) {
      if (c.offsetParent !== null) {
        sizeWrap(c);
        const wrap = c.querySelector<HTMLElement>('.image-zoom-wrap')!;
        clampPan(sharedZoom, c, wrap);
        applyToCanvas(c);
      }
    }
  }).observe(container);

  // Bottom toolbar controls
  const imageToolbar = document.querySelector('.diff-toolbar-image');

  // Mode switching from bottom toolbar
  imageToolbar?.querySelectorAll('[data-image-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.imageMode!;
      state.lastImageMode = mode;
      imageToolbar.querySelectorAll('[data-image-mode]').forEach(b => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.image-diff-panel').forEach(p => p.classList.toggle('active', (p as HTMLElement).dataset.panel === mode));
      requestAnimationFrame(() => syncVisible());
    });
  });

  // Helper: get the currently visible canvas
  function getVisibleCanvas(): { canvas: HTMLElement; wrap: HTMLElement } | null {
    for (const c of canvases) {
      if (c.offsetParent !== null) {
        return { canvas: c, wrap: c.querySelector<HTMLElement>('.image-zoom-wrap')! };
      }
    }
    return null;
  }

  // Set up zoom/pan interaction on each canvas
  for (const canvas of canvases) {
    const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap')!;

    (canvas as any)._zs = sharedZoom;
    (canvas as any)._onZoomChange = null as (() => void) | null;

    // Wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      userHasZoomed = true;
      zoomAt(sharedZoom, canvas, wrap, e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.1);
      applyToAll();
    }, { passive: false });

    // Drag to pan
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

  // Zoom toolbar buttons from bottom toolbar — target whichever canvas is visible
  imageToolbar?.querySelectorAll<HTMLElement>('[data-zoom-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const vis = getVisibleCanvas();
      if (!vis) return;
      const action = btn.dataset.zoomAction;
      const rect = vis.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (action === 'in') {
        userHasZoomed = true;
        zoomAt(sharedZoom, vis.canvas, vis.wrap, cx, cy, 1.4);
      } else if (action === 'out') {
        userHasZoomed = true;
        zoomAt(sharedZoom, vis.canvas, vis.wrap, cx, cy, 0.7);
      } else if (action === 'fit') {
        sharedZoom.zoom = 1; sharedZoom.panX = 0; sharedZoom.panY = 0;
        userHasZoomed = false;
        syncVisible();
      } else if (action === 'actual') {
        const nw = refImg.naturalWidth, nh = refImg.naturalHeight;
        if (nw && nh) {
          vis.wrap.style.width = `${nw}px`;
          vis.wrap.style.height = `${nh}px`;
          sharedZoom.zoom = 1; sharedZoom.panX = 0; sharedZoom.panY = 0;
          userHasZoomed = true;
        }
      }
      applyToAll();
    });
  });

  // Init slice tool (comparison mode only)
  if (hasComparison) {
    const sliceCanvas = container.querySelector('[data-panel="slice"] .image-visual-canvas') as HTMLElement | null;
    if (sliceCanvas) initSliceTool(sliceCanvas);
  }

  // For one-sided images, activate the image panel by default
  if (!hasComparison) {
    const imagePanel = container.querySelector('[data-panel="image"]');
    const metaPanel = container.querySelector('[data-panel="metadata"]');
    if (imagePanel && metaPanel) {
      // Start with metadata active (default), image panel is available via toolbar
    }
  }
}

// --- Metadata ---

async function loadMetadata(fileId: string, container: Element) {
  const panel = container.querySelector('.image-diff-metadata');
  if (!panel) return;
  try {
    const data = await api<{ old: string[] | null; new: string[] | null }>(`/image/${fileId}/metadata`);
    renderMetadataDiff(panel, data.old, data.new);
  } catch {
    panel.innerHTML = '<div class="image-metadata-error">Could not load metadata</div>';
  }
}

function renderMetadataDiff(panel: Element, oldLines: string[] | null, newLines: string[] | null) {
  if (!oldLines && !newLines) { panel.innerHTML = '<div class="image-metadata-error">No metadata available</div>'; return; }
  if (!oldLines || !newLines) {
    const lines = (oldLines ?? newLines)!;
    panel.innerHTML = '<div class="image-metadata-single">' + lines.map(l => `<div class="metadata-line">${esc(l)}</div>`).join('') + '</div>';
    return;
  }
  const allKeys = new Set<string>();
  const oldMap = new Map<string, string>();
  const newMap = new Map<string, string>();
  for (const line of oldLines) { const [key] = line.split(': ', 1); oldMap.set(key, line); allKeys.add(key); }
  for (const line of newLines) { const [key] = line.split(': ', 1); newMap.set(key, line); allKeys.add(key); }
  let html = '<div class="image-metadata-diff">';
  for (const key of allKeys) {
    const o = oldMap.get(key), n = newMap.get(key);
    if (o && n && o === n) html += `<div class="metadata-line context">${esc(o)}</div>`;
    else { if (o) html += `<div class="metadata-line remove">${esc(o)}</div>`; if (n) html += `<div class="metadata-line add">${esc(n)}</div>`; }
  }
  panel.innerHTML = html + '</div>';
}

function esc(t: string): string { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// --- Zoom helpers ---

interface ZoomState {
  zoom: number;
  panX: number;
  panY: number;
}

function zoomAt(zs: ZoomState, canvas: HTMLElement, wrap: HTMLElement, clientX: number, clientY: number, factor: number) {
  const contentX = canvas.getBoundingClientRect().left + canvas.clientLeft;
  const contentY = canvas.getBoundingClientRect().top + canvas.clientTop;
  const wbx = wrap.offsetLeft;
  const wby = wrap.offsetTop;
  const mx = (clientX - contentX - wbx - zs.panX) / zs.zoom;
  const my = (clientY - contentY - wby - zs.panY) / zs.zoom;

  const oldZoom = zs.zoom;
  const newZoom = Math.max(1, Math.min(10, oldZoom * factor));
  zs.panX += mx * (oldZoom - newZoom);
  zs.panY += my * (oldZoom - newZoom);
  zs.zoom = newZoom;
  clampPan(zs, canvas, wrap);
}

function clampPan(zs: ZoomState, canvas: HTMLElement, wrap: HTMLElement) {
  const ww = wrap.offsetWidth * zs.zoom;
  const wh = wrap.offsetHeight * zs.zoom;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (ww <= cw && wh <= ch) { zs.panX = 0; zs.panY = 0; return; }
  if (ww > cw) {
    const baseLeft = (cw - wrap.offsetWidth) / 2;
    zs.panX = Math.max(cw - baseLeft - ww, Math.min(-baseLeft, zs.panX));
  } else { zs.panX = 0; }
  if (wh > ch) {
    const baseTop = (ch - wrap.offsetHeight) / 2;
    zs.panY = Math.max(ch - baseTop - wh, Math.min(-baseTop, zs.panY));
  } else { zs.panY = 0; }
}

function applyZoom(wrap: HTMLElement, zs: ZoomState) {
  wrap.style.transform = zs.zoom <= 1
    ? ''
    : `translate(${zs.panX}px, ${zs.panY}px) scale(${zs.zoom})`;
  const canvas = wrap.parentElement;
  if (canvas) (canvas as any)._onZoomChange?.();
}

// --- Slice Tool ---

interface SliceState {
  canvas: HTMLElement;
  wrap: HTMLElement;
  clipped: HTMLImageElement;
  line: HTMLElement;
  handleA: HTMLElement;
  handleB: HTMLElement;
  ax: number; ay: number;
  bx: number; by: number;
  dragging: 'a' | 'b' | null;
}

function screenToCanvas(e: MouseEvent, canvas: HTMLElement): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth,
    y: (e.clientY - rect.top - canvas.clientTop) / canvas.clientHeight,
  };
}

function initSliceTool(canvas: HTMLElement) {
  const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap')!;
  const clipped = canvas.querySelector<HTMLImageElement>('.image-slice-clipped')!;
  const line = canvas.querySelector<HTMLElement>('.slice-line')!;
  const handleA = canvas.querySelector<HTMLElement>('.slice-handle-a')!;
  const handleB = canvas.querySelector<HTMLElement>('.slice-handle-b')!;

  const ss: SliceState = {
    canvas, wrap, clipped, line, handleA, handleB,
    ax: 0.5, ay: 0,
    bx: 0.5, by: 1,
    dragging: null,
  };

  updateSlice(ss);

  (canvas as any)._onZoomChange = () => updateSlice(ss);

  handleA.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); ss.dragging = 'a'; });
  handleB.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); ss.dragging = 'b'; });

  document.addEventListener('mousemove', (e) => {
    if (!ss.dragging) return;
    const norm = screenToCanvas(e, canvas);
    const otherEdge = ss.dragging === 'a' ? getEdge(ss.bx, ss.by) : getEdge(ss.ax, ss.ay);
    const snapped = snapToEdge(norm.x, norm.y, otherEdge);
    if (ss.dragging === 'a') { ss.ax = snapped.x; ss.ay = snapped.y; }
    else { ss.bx = snapped.x; ss.by = snapped.y; }
    updateSlice(ss);
  });

  document.addEventListener('mouseup', () => { ss.dragging = null; });

  new ResizeObserver(() => updateSlice(ss)).observe(canvas);
}

type Edge = 'top' | 'right' | 'bottom' | 'left';

function getEdge(x: number, y: number): Edge {
  if (y === 0) return 'top';
  if (x === 1) return 'right';
  if (y === 1) return 'bottom';
  return 'left';
}

function snapToEdge(x: number, y: number, avoidEdge: Edge): { x: number; y: number } {
  const cx = Math.max(0, Math.min(1, x));
  const cy = Math.max(0, Math.min(1, y));
  const candidates: Array<{ edge: Edge; x: number; y: number; dist: number }> = [
    { edge: 'top',    x: cx, y: 0, dist: cy },
    { edge: 'bottom', x: cx, y: 1, dist: 1 - cy },
    { edge: 'left',   x: 0, y: cy, dist: cx },
    { edge: 'right',  x: 1, y: cy, dist: 1 - cx },
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates.find(c => c.edge !== avoidEdge) ?? candidates[0];
  return { x: best.x, y: best.y };
}

function updateSlice(ss: SliceState) {
  const cw = ss.canvas.clientWidth;
  const ch = ss.canvas.clientHeight;
  if (!cw || !ch) return;

  ss.handleA.style.left = `${ss.ax * 100}%`;
  ss.handleA.style.top = `${ss.ay * 100}%`;
  ss.handleB.style.left = `${ss.bx * 100}%`;
  ss.handleB.style.top = `${ss.by * 100}%`;

  const ax = ss.ax * cw, ay = ss.ay * ch;
  const bx = ss.bx * cw, by = ss.by * ch;
  const len = Math.hypot(bx - ax, by - ay);
  const angle = Math.atan2(by - ay, bx - ax) * (180 / Math.PI);
  ss.line.style.width = `${len}px`;
  ss.line.style.left = `${ax}px`;
  ss.line.style.top = `${ay}px`;
  ss.line.style.transform = `rotate(${angle}deg)`;
  ss.line.style.transformOrigin = '0 0';

  ss.clipped.style.clipPath = buildClipPath(ss);
}

// --- Clip-path geometry ---

function edgePos(x: number, y: number): number {
  if (y === 0) return x;
  if (x === 1) return 1 + y;
  if (y === 1) return 2 + (1 - x);
  return 3 + (1 - y);
}

function cwDist(from: number, to: number): number {
  const d = to - from;
  return d >= 0 ? d : d + 4;
}

function canvasToImagePct(cnx: number, cny: number, ss: SliceState, zs: ZoomState): string {
  const cw = ss.canvas.clientWidth;
  const ch = ss.canvas.clientHeight;
  const ww = ss.wrap.offsetWidth;
  const wh = ss.wrap.offsetHeight;
  const wbx = ss.wrap.offsetLeft;
  const wby = ss.wrap.offsetTop;
  const px = cnx * cw;
  const py = cny * ch;
  const wx = (px - wbx - zs.panX) / zs.zoom;
  const wy = (py - wby - zs.panY) / zs.zoom;
  return `${(wx / ww) * 100}% ${(wy / wh) * 100}%`;
}

function buildClipPath(ss: SliceState): string {
  const zs: ZoomState = (ss.canvas as any)._zs ?? { zoom: 1, panX: 0, panY: 0 };
  const tA = edgePos(ss.ax, ss.ay);
  const tB = edgePos(ss.bx, ss.by);
  const dAB = cwDist(tA, tB);

  const corners = [
    { t: 0, x: 0, y: 0 },
    { t: 1, x: 1, y: 0 },
    { t: 2, x: 1, y: 1 },
    { t: 3, x: 0, y: 1 },
  ];

  const between = corners
    .filter(c => { const d = cwDist(tA, c.t); return d > 0.001 && d < dAB - 0.001; })
    .sort((a, b) => cwDist(tA, a.t) - cwDist(tA, b.t));

  const pts = [canvasToImagePct(ss.ax, ss.ay, ss, zs)];
  for (const c of between) pts.push(canvasToImagePct(c.x, c.y, ss, zs));
  pts.push(canvasToImagePct(ss.bx, ss.by, ss, zs));

  return `polygon(${pts.join(', ')})`;
}
