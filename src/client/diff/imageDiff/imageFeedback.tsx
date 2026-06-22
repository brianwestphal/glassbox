import type { SafeHtml } from 'kerfjs';

import {
  createAnnotation,
  deleteAnnotation as deleteAnnotationApi,
  type ImageRegion,
  listAllAnnotations,
  updateAnnotation as updateAnnotationApi,
} from '../../../api/index.js';
import { toElement } from '../../dom.js';
import { reviewStore } from '../../stores/index.js';
import {
  clientToFraction,
  formatRegionPct,
  isDrawnRegion,
  parseRegion,
  rectFromPoints,
  regionStyle,
} from './regionGeometry.js';

/**
 * Image feedback (doc 23): general comments about an image plus comments
 * anchored to rectangle regions the user draws on the image. Regions are stored
 * in normalized [0,1] coordinates and shown over every comparison mode
 * (difference / slice / single image), so they land in the same place on both
 * the A and B sides.
 *
 * This runs imperatively under the diff view's `data-morph-skip` subtree
 * (alongside the slice tool and zoom/pan), so it owns its DOM directly rather
 * than going through a kerf `mount()`.
 */

interface RegionItem {
  id: string;
  region: ImageRegion;
  content: string;
}

interface CommentItem {
  id: string;
  content: string;
}

export function initImageFeedback(container: HTMLElement): void {
  const fileId = container.dataset.fileId ?? '';
  if (fileId === '') return;

  const panelMaybe = container.querySelector<HTMLElement>('[data-image-feedback]');
  if (panelMaybe === null) return;
  const panel: HTMLElement = panelMaybe;

  const overlays = Array.from(container.querySelectorAll<HTMLElement>('[data-region-overlay]'));

  let regions: RegionItem[] = [];
  let comments: CommentItem[] = [];
  let drawMode = false;
  // A region the user just drew, awaiting its first comment before it is saved.
  let pending: ImageRegion | null = null;

  function bumpCount(delta: number): void {
    const prev = reviewStore.state.value.annotationCounts[fileId] ?? 0;
    reviewStore.actions.setAnnotationCount(fileId, Math.max(0, prev + delta));
  }

  // --- Rendering ----------------------------------------------------------

  function renderOverlays(): void {
    for (const overlay of overlays) {
      const boxes: SafeHtml[] = regions.map((r, i) => regionBoxJsx(r.region, i + 1, false));
      if (pending !== null) boxes.push(regionBoxJsx(pending, regions.length + 1, true));
      overlay.replaceChildren(...boxes.map((b) => toElement(b)));
      overlay.style.pointerEvents = drawMode ? 'auto' : 'none';
      overlay.style.cursor = drawMode ? 'crosshair' : '';
    }
  }

  function renderPanel(): void {
    panel.replaceChildren(toElement(feedbackPanelJsx(comments, regions, drawMode, pending !== null)));
    if (pending !== null) {
      panel.querySelector<HTMLTextAreaElement>('[data-role="pending-input"]')?.focus();
    }
  }

  function renderAll(): void {
    renderOverlays();
    renderPanel();
  }

  // --- Persistence --------------------------------------------------------

  async function load(): Promise<void> {
    try {
      const all = await listAllAnnotations();
      const mine = all.filter((a) => a.review_file_id === fileId && a.line_number === 0);
      regions = [];
      comments = [];
      for (const a of mine) {
        const region = parseRegion(a.region_data);
        if (region !== null) regions.push({ id: a.id, region, content: a.content });
        else comments.push({ id: a.id, content: a.content });
      }
    } catch {
      // Leave the lists empty on a load failure — the panel still works for new input.
    }
    renderAll();
  }

  async function addComment(content: string, region?: ImageRegion): Promise<void> {
    const saved = await createAnnotation({
      reviewFileId: fileId,
      lineNumber: 0,
      side: 'new',
      category: 'note',
      content,
      ...(region !== undefined ? { region } : {}),
    });
    if (region !== undefined) regions.push({ id: saved.id, region, content });
    else comments.push({ id: saved.id, content });
    bumpCount(1);
  }

  async function removeItem(id: string): Promise<void> {
    await deleteAnnotationApi({ id });
    regions = regions.filter((r) => r.id !== id);
    comments = comments.filter((c) => c.id !== id);
    bumpCount(-1);
    renderAll();
  }

  async function saveEdit(id: string, content: string): Promise<void> {
    await updateAnnotationApi({ id, content, category: 'note' });
    const region = regions.find((r) => r.id === id);
    if (region !== undefined) region.content = content;
    const comment = comments.find((c) => c.id === id);
    if (comment !== undefined) comment.content = content;
    renderAll();
  }

  // --- Drawing ------------------------------------------------------------

  function setDrawMode(on: boolean): void {
    drawMode = on;
    if (!on) pending = null;
    renderAll();
  }

  function beginDraw(overlay: HTMLElement, e: MouseEvent): void {
    if (!drawMode) return;
    // Keep the canvas pan handler from also firing for this drag.
    e.stopPropagation();
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const start = clientToFraction(rect, e.clientX, e.clientY);
    pending = { x: start.x, y: start.y, w: 0, h: 0 };

    const onMove = (ev: MouseEvent) => {
      const cur = clientToFraction(rect, ev.clientX, ev.clientY);
      pending = rectFromPoints(start, cur);
      renderOverlays();
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const cur = clientToFraction(rect, ev.clientX, ev.clientY);
      const drawn = rectFromPoints(start, cur);
      if (isDrawnRegion(drawn)) {
        pending = drawn;
        drawMode = false; // exit draw mode; the pending region awaits its comment
        renderAll();
      } else {
        pending = null;
        renderAll();
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // --- Event wiring -------------------------------------------------------

  for (const overlay of overlays) {
    overlay.addEventListener('mousedown', (e) => beginDraw(overlay, e));
  }

  panel.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl === null) return;
    const action = actionEl.dataset.action;
    const itemEl = actionEl.closest<HTMLElement>('[data-id]');
    const id = itemEl?.dataset.id;

    if (action === 'toggle-draw') {
      setDrawMode(!drawMode);
    } else if (action === 'add-general') {
      const input = panel.querySelector<HTMLTextAreaElement>('[data-role="general-input"]');
      const text = input?.value.trim() ?? '';
      if (text === '') return;
      void addComment(text).then(renderAll);
    } else if (action === 'save-pending') {
      const input = panel.querySelector<HTMLTextAreaElement>('[data-role="pending-input"]');
      const text = input?.value.trim() ?? '';
      if (text === '' || pending === null) return;
      const region = pending;
      pending = null;
      void addComment(text, region).then(renderAll);
    } else if (action === 'cancel-pending') {
      pending = null;
      renderAll();
    } else if (action === 'delete' && id !== undefined) {
      void removeItem(id);
    } else if (action === 'edit' && itemEl !== null && id !== undefined) {
      beginInlineEdit(itemEl, id);
    } else if (action === 'save-edit' && itemEl !== null && id !== undefined) {
      const input = itemEl.querySelector<HTMLTextAreaElement>('[data-role="edit-input"]');
      const text = input?.value.trim() ?? '';
      if (text === '') return;
      void saveEdit(id, text);
    } else if (action === 'cancel-edit') {
      renderAll();
    }
  });

  // Ctrl/Cmd+Enter saves whichever composer/editor the cursor is in.
  panel.addEventListener('keydown', (e) => {
    if (!(e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const role = target.getAttribute('data-role');
    if (role === 'general-input') {
      e.preventDefault();
      panel.querySelector<HTMLElement>('[data-action="add-general"]')?.click();
    } else if (role === 'pending-input') {
      e.preventDefault();
      panel.querySelector<HTMLElement>('[data-action="save-pending"]')?.click();
    } else if (role === 'edit-input') {
      e.preventDefault();
      target.closest<HTMLElement>('[data-id]')?.querySelector<HTMLElement>('[data-action="save-edit"]')?.click();
    }
  });

  function beginInlineEdit(itemEl: HTMLElement, id: string): void {
    const current = regions.find((r) => r.id === id)?.content
      ?? comments.find((c) => c.id === id)?.content ?? '';
    const body = itemEl.querySelector<HTMLElement>('[data-role="item-body"]');
    if (body === null) return;
    body.replaceChildren(toElement(inlineEditorJsx(current)));
    body.querySelector<HTMLTextAreaElement>('[data-role="edit-input"]')?.focus();
  }

  void load();
}

// --- JSX views ------------------------------------------------------------

function regionBoxJsx(region: ImageRegion, number: number, isPending: boolean): SafeHtml {
  const s = regionStyle(region);
  const cls = isPending ? 'region-box region-box-pending' : 'region-box';
  return (
    <div className={cls} style={`left:${s.left};top:${s.top};width:${s.width};height:${s.height}`}>
      <span className="region-badge">{String(number)}</span>
    </div>
  );
}

function inlineEditorJsx(content: string): SafeHtml {
  return (
    <div className="image-feedback-edit">
      <textarea className="image-feedback-input" data-role="edit-input">{content}</textarea>
      <div className="image-feedback-actions">
        <button className="btn btn-xs" data-action="cancel-edit">Cancel</button>
        <button className="btn btn-xs btn-primary" data-action="save-edit">Save</button>
      </div>
    </div>
  );
}

function commentItemJsx(c: CommentItem): SafeHtml {
  return (
    <li className="image-feedback-item" data-id={c.id}>
      <div className="image-feedback-item-body" data-role="item-body">
        <span className="image-feedback-text">{c.content}</span>
      </div>
      <div className="image-feedback-item-actions">
        <button className="btn btn-xs btn-icon" data-action="edit" title="Edit">✎</button>
        <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete">✕</button>
      </div>
    </li>
  );
}

function regionItemJsx(r: RegionItem, number: number): SafeHtml {
  return (
    <li className="image-feedback-item" data-id={r.id}>
      <span className="region-badge region-badge-list">{String(number)}</span>
      <div className="image-feedback-item-body" data-role="item-body">
        <span className="image-feedback-region-pct">{formatRegionPct(r.region)}</span>
        <span className="image-feedback-text">{r.content}</span>
      </div>
      <div className="image-feedback-item-actions">
        <button className="btn btn-xs btn-icon" data-action="edit" title="Edit">✎</button>
        <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete">✕</button>
      </div>
    </li>
  );
}

function pendingRegionItemJsx(number: number): SafeHtml {
  return (
    <li className="image-feedback-item image-feedback-item-pending" data-id="pending">
      <span className="region-badge region-badge-list">{String(number)}</span>
      <div className="image-feedback-item-body">
        <textarea className="image-feedback-input" data-role="pending-input"
          placeholder="Describe this region…"></textarea>
        <div className="image-feedback-actions">
          <button className="btn btn-xs" data-action="cancel-pending">Cancel</button>
          <button className="btn btn-xs btn-primary" data-action="save-pending">Add region</button>
        </div>
      </div>
    </li>
  );
}

function feedbackPanelJsx(
  comments: CommentItem[],
  regions: RegionItem[],
  drawMode: boolean,
  hasPending: boolean,
): SafeHtml {
  return (
    <div className="image-feedback-inner">
      <div className="image-feedback-bar">
        <button className={`btn btn-sm ${drawMode ? 'active' : ''}`} data-action="toggle-draw">
          {drawMode ? 'Drawing…' : '▭ Draw region'}
        </button>
        <span className="image-feedback-hint">
          {drawMode ? 'Drag a rectangle on the image to mark a region' : 'Comment on this image, or draw a region to anchor a comment'}
        </span>
      </div>

      <div className="image-feedback-section">
        <div className="image-feedback-heading">General comments</div>
        <div className="image-feedback-composer">
          <textarea className="image-feedback-input" data-role="general-input"
            placeholder="Add a comment about this image…"></textarea>
          <button className="btn btn-sm btn-primary" data-action="add-general">Add</button>
        </div>
        {comments.length > 0 && (
          <ul className="image-feedback-list" data-list="general">
            {comments.map((c) => commentItemJsx(c))}
          </ul>
        )}
      </div>

      <div className="image-feedback-section">
        <div className="image-feedback-heading">Regions ({String(regions.length + (hasPending ? 1 : 0))})</div>
        {(regions.length > 0 || hasPending) && (
          <ul className="image-feedback-list" data-list="regions">
            {regions.map((r, i) => regionItemJsx(r, i + 1))}
            {hasPending && pendingRegionItemJsx(regions.length + 1)}
          </ul>
        )}
      </div>
    </div>
  );
}
