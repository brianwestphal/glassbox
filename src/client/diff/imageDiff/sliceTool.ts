import { asEl } from '../../dom.js';
import { cwDist, edgeHandleTransform, edgePos, getEdge, snapToEdge } from './sliceGeometry.js';
import { getZoomState, onZoomChange, type ZoomState } from './zoom.js';

interface SliceState {
  canvas: HTMLElement;
  wrap: HTMLElement;
  oldImg: HTMLImageElement;
  clipped: HTMLImageElement;
  line: HTMLElement;
  handleA: HTMLElement;
  handleB: HTMLElement;
  ax: number; ay: number;
  bx: number; by: number;
  dragging: 'a' | 'b' | null;
}

export function initSliceTool(canvasEl: Element): void {
  const canvas = asEl(canvasEl);
  const wrap = canvas.querySelector<HTMLElement>('.image-zoom-wrap');
  const oldImg = canvas.querySelector<HTMLImageElement>('.image-layer-old');
  const clipped = canvas.querySelector<HTMLImageElement>('.image-slice-clipped');
  const line = canvas.querySelector<HTMLElement>('.slice-line');
  const handleA = canvas.querySelector<HTMLElement>('.slice-handle-a');
  const handleB = canvas.querySelector<HTMLElement>('.slice-handle-b');
  if (wrap === null || oldImg === null || clipped === null || line === null || handleA === null || handleB === null) return;

  const ss: SliceState = {
    canvas, wrap, oldImg, clipped, line, handleA, handleB,
    ax: 0.5, ay: 0,
    bx: 0.5, by: 1,
    dragging: null,
  };

  updateSlice(ss);
  onZoomChange(canvas, () => { updateSlice(ss); });

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

  new ResizeObserver(() => { updateSlice(ss); }).observe(canvas);
}

function screenToCanvas(e: MouseEvent, canvas: HTMLElement): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth,
    y: (e.clientY - rect.top - canvas.clientTop) / canvas.clientHeight,
  };
}

function updateSlice(ss: SliceState): void {
  const cw = ss.canvas.clientWidth;
  const ch = ss.canvas.clientHeight;
  if (!cw || !ch) return;

  ss.handleA.style.left = `${ss.ax * 100}%`;
  ss.handleA.style.top = `${ss.ay * 100}%`;
  ss.handleA.style.transform = edgeHandleTransform(getEdge(ss.ax, ss.ay));
  ss.handleB.style.left = `${ss.bx * 100}%`;
  ss.handleB.style.top = `${ss.by * 100}%`;
  ss.handleB.style.transform = edgeHandleTransform(getEdge(ss.bx, ss.by));

  const ax = ss.ax * cw;
  const ay = ss.ay * ch;
  const bx = ss.bx * cw;
  const by = ss.by * ch;
  const len = Math.hypot(bx - ax, by - ay);
  const angle = Math.atan2(by - ay, bx - ax) * (180 / Math.PI);
  ss.line.style.width = `${len}px`;
  ss.line.style.left = `${ax}px`;
  ss.line.style.top = `${ay}px`;
  ss.line.style.transform = `rotate(${angle}deg)`;
  ss.line.style.transformOrigin = '0 0';

  ss.clipped.style.clipPath = buildClipPath(ss, false);
  ss.oldImg.style.clipPath = buildClipPath(ss, true);
}

// --- Clip-path geometry ---

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

/**
 * Build a clip-path polygon for one side of the slice line.
 * invert=false: clips to the A→B clockwise side (used for the new image)
 * invert=true:  clips to the B→A clockwise side (used for the old image)
 */
function buildClipPath(ss: SliceState, invert: boolean): string {
  const zs: ZoomState = getZoomState(ss.canvas) ?? { zoom: 1, panX: 0, panY: 0 };

  const startX = invert ? ss.bx : ss.ax;
  const startY = invert ? ss.by : ss.ay;
  const endX = invert ? ss.ax : ss.bx;
  const endY = invert ? ss.ay : ss.by;

  const tStart = edgePos(startX, startY);
  const tEnd = edgePos(endX, endY);
  const dist = cwDist(tStart, tEnd);

  const corners = [
    { t: 0, x: 0, y: 0 },
    { t: 1, x: 1, y: 0 },
    { t: 2, x: 1, y: 1 },
    { t: 3, x: 0, y: 1 },
  ];

  const between = corners
    .filter(c => { const d = cwDist(tStart, c.t); return d > 0.001 && d < dist - 0.001; })
    .sort((a, b) => cwDist(tStart, a.t) - cwDist(tStart, b.t));

  const pts = [canvasToImagePct(startX, startY, ss, zs)];
  for (const c of between) pts.push(canvasToImagePct(c.x, c.y, ss, zs));
  pts.push(canvasToImagePct(endX, endY, ss, zs));

  return `polygon(${pts.join(', ')})`;
}
