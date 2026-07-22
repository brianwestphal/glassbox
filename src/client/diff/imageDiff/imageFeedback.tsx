import type { SafeHtml } from 'kerfjs';

import {
  type AnnotationCategory,
  createAnnotation,
  deleteAnnotation as deleteAnnotationApi,
  type ImageRegion,
  listAllAnnotations,
  updateAnnotation as updateAnnotationApi,
  updateAnnotationRegion as updateAnnotationRegionApi,
} from '../../../api/index.js';
import { IconEdit, IconPaperclip, IconSquareDashed, IconTrash } from '../../../icons.js';
import { hydrateAttachments } from '../../annotations/attachments.js';
import { showCategoryPicker } from '../../annotations/categories.js';
import { toElement } from '../../dom.js';
import { CATEGORIES } from '../../state.js';
import { reviewStore } from '../../stores/index.js';
import { showToast } from '../../toast.js';
import {
  clientToFraction,
  cursorForHandle,
  formatRegionPct,
  hitTestRegion,
  isDrawnRegion,
  moveRegion,
  parseRegion,
  rectFromPoints,
  type RegionHandle,
  regionStyle,
  resizeRegion,
} from './regionGeometry.js';

/**
 * Image feedback (doc 23): general comments about an image plus comments
 * anchored to rectangle regions the user draws on the image. Regions are stored
 * in normalized [0,1] coordinates and shown over every comparison mode
 * (difference / slice / single image).
 *
 * Beyond the first iteration this also supports: picking a category for each
 * comment (§23.6), scoping a region to the A-only or B-only side (§23.6/§23.10),
 * hover-linking a list row to its box (§23.10), and dragging a box to move or
 * resize it (§23.10).
 *
 * This runs imperatively under the diff view's `data-morph-skip` subtree
 * (alongside the slice tool and zoom/pan), so it owns its DOM directly rather
 * than going through a kerf `mount()`.
 */

/** Per-side scope of a region: `old` = A-only, `new` = B-only, undefined = both. */
type RegionScope = 'old' | 'new' | undefined;

interface RegionItem {
  id: string;
  region: ImageRegion;
  content: string;
  category: string;
}

interface CommentItem {
  id: string;
  content: string;
  category: string;
}

const DEFAULT_CATEGORY = 'note';

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
  // Category chosen in the general-comment and pending-region composers.
  let generalCategory = DEFAULT_CATEGORY;
  let pendingCategory = DEFAULT_CATEGORY;
  // True while a move/resize drag is in flight, to suppress hover cursor churn.
  let dragging = false;

  function bumpCount(delta: number): void {
    const prev = reviewStore.state.value.annotationCounts[fileId] ?? 0;
    reviewStore.actions.setAnnotationCount(fileId, Math.max(0, prev + delta));
  }

  // --- Rendering ----------------------------------------------------------

  function renderOverlays(): void {
    for (const overlay of overlays) {
      // A side-by-side pane's overlay carries `data-region-side` (old/new). On a
      // sided overlay, a region scoped to the *other* side is hidden; unscoped
      // (A+B) regions show on both. Overlays without a side (difference / slice /
      // single image) show every region. Badge numbers stay the global 1..N so
      // they line up with the region list in the feedback panel (doc 24).
      const side = overlay.dataset.regionSide;
      const shows = (scope: RegionScope): boolean =>
        side === undefined || scope === undefined || scope === side;
      const boxes: SafeHtml[] = [];
      regions.forEach((r, i) => {
        if (shows(r.region.side)) boxes.push(regionBoxJsx(r.region, i + 1, r.id, false));
      });
      if (pending !== null && shows(pending.side)) {
        boxes.push(regionBoxJsx(pending, regions.length + 1, 'pending', true));
      }
      overlay.replaceChildren(...boxes.map((b) => toElement(b)));
      overlay.classList.toggle('draw-mode', drawMode);
      overlay.style.pointerEvents = drawMode ? 'auto' : 'none';
      overlay.style.cursor = drawMode ? 'crosshair' : '';
    }
  }

  function renderPanel(): void {
    panel.replaceChildren(toElement(
      feedbackPanelJsx(comments, regions, drawMode, pending, generalCategory, pendingCategory),
    ));
    if (pending !== null) {
      panel.querySelector<HTMLTextAreaElement>('[data-role="pending-input"]')?.focus();
    }
    // `replaceChildren` wiped the per-item `[data-att-list]` containers; refill
    // their attachment chips (doc 25 / GB-956). Async + idempotent.
    void hydrateAttachments(panel);
  }

  function renderAll(): void {
    renderOverlays();
    renderPanel();
  }

  // --- Highlight link (region list row <-> box on the image) --------------

  function setHighlight(id: string, on: boolean): void {
    for (const overlay of overlays) {
      overlay.querySelector<HTMLElement>(`.region-box[data-region-id="${id}"]`)
        ?.classList.toggle('region-box-active', on);
    }
    panel.querySelector<HTMLElement>(`.image-feedback-item[data-id="${id}"]`)
      ?.classList.toggle('image-feedback-item-active', on);
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
        if (region !== null) regions.push({ id: a.id, region, content: a.content, category: a.category });
        else comments.push({ id: a.id, content: a.content, category: a.category });
      }
    } catch {
      // Leave the lists empty on a load failure — the panel still works for new input.
    }
    renderAll();
  }

  async function addComment(content: string, category: string, region?: ImageRegion): Promise<void> {
    const saved = await createAnnotation({
      reviewFileId: fileId,
      lineNumber: 0,
      // The annotation's `side` column is only meaningful for line annotations;
      // an image region carries its own scope in `region.side`. Mirror the scope
      // here so the column is at least consistent, defaulting to `new`.
      side: region?.side === 'old' ? 'old' : 'new',
      category: category as AnnotationCategory,
      content,
      ...(region !== undefined ? { region } : {}),
    });
    if (region !== undefined) regions.push({ id: saved.id, region, content, category });
    else comments.push({ id: saved.id, content, category });
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
    const region = regions.find((r) => r.id === id);
    const comment = comments.find((c) => c.id === id);
    const category = region?.category ?? comment?.category ?? DEFAULT_CATEGORY;
    await updateAnnotationApi({ id, content, category: category as AnnotationCategory });
    if (region !== undefined) region.content = content;
    if (comment !== undefined) comment.content = content;
    renderAll();
  }

  async function saveCategory(id: string, category: string): Promise<void> {
    const region = regions.find((r) => r.id === id);
    const comment = comments.find((c) => c.id === id);
    const content = region?.content ?? comment?.content ?? '';
    if (content === '') return;
    await updateAnnotationApi({ id, content, category: category as AnnotationCategory });
    if (region !== undefined) region.category = category;
    if (comment !== undefined) comment.category = category;
    renderAll();
  }

  async function saveScope(id: string, scope: RegionScope): Promise<void> {
    const region = regions.find((r) => r.id === id);
    if (region === undefined) return;
    const next: ImageRegion = scope === undefined
      ? { x: region.region.x, y: region.region.y, w: region.region.w, h: region.region.h }
      : { ...region.region, side: scope };
    region.region = next;
    renderAll();
    await updateAnnotationRegionApi({ id, region: next });
  }

  async function saveGeometry(id: string, region: ImageRegion): Promise<void> {
    await updateAnnotationRegionApi({ id, region });
  }

  // --- Drawing ------------------------------------------------------------

  function setDrawMode(on: boolean): void {
    drawMode = on;
    if (!on) {
      pending = null;
      pendingCategory = DEFAULT_CATEGORY;
    }
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
        pendingCategory = DEFAULT_CATEGORY;
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

  // --- Move / resize an existing region -----------------------------------

  function beginMoveResize(overlay: HTMLElement, box: HTMLElement, id: string, handle: RegionHandle, e: MouseEvent): void {
    const item = regions.find((r) => r.id === id);
    if (item === undefined) return;
    // Don't let the canvas pan handler fire for this drag.
    e.stopPropagation();
    e.preventDefault();
    dragging = true;
    const rect = overlay.getBoundingClientRect();
    const start = clientToFraction(rect, e.clientX, e.clientY);
    const startRegion = item.region;
    overlay.style.cursor = cursorForHandle(handle);

    const onMove = (ev: MouseEvent) => {
      const cur = clientToFraction(rect, ev.clientX, ev.clientY);
      item.region = handle === 'move'
        ? moveRegion(startRegion, cur.x - start.x, cur.y - start.y)
        : resizeRegion(startRegion, handle, cur);
      renderOverlays();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragging = false;
      overlay.style.cursor = '';
      saveGeometry(id, item.region).catch(() => { showToast('Saving the moved region failed'); });
      renderAll();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // --- Event wiring (overlay) ---------------------------------------------

  for (const overlay of overlays) {
    overlay.addEventListener('mousedown', (e) => {
      if (drawMode) {
        beginDraw(overlay, e);
        return;
      }
      const box = e.target instanceof HTMLElement
        ? e.target.closest<HTMLElement>('.region-box[data-region-id]')
        : null;
      if (box === null) return;
      const id = box.dataset.regionId;
      if (id === undefined || id === 'pending') return;
      const handle = hitTestRegion(box.getBoundingClientRect(), e.clientX, e.clientY);
      if (handle === null) return;
      beginMoveResize(overlay, box, id, handle, e);
    });

    // Cursor feedback while hovering a box (move/resize affordance).
    overlay.addEventListener('mousemove', (e) => {
      if (drawMode || dragging) return;
      const box = e.target instanceof HTMLElement
        ? e.target.closest<HTMLElement>('.region-box[data-region-id]')
        : null;
      if (box === null) return;
      const handle = hitTestRegion(box.getBoundingClientRect(), e.clientX, e.clientY);
      box.style.cursor = handle !== null ? cursorForHandle(handle) : '';
    });

    // Hover-link: highlight the matching region list row.
    overlay.addEventListener('mouseover', (e) => {
      const id = boxIdFromEvent(e);
      if (id !== null) setHighlight(id, true);
    });
    overlay.addEventListener('mouseout', (e) => {
      const id = boxIdFromEvent(e);
      if (id !== null) setHighlight(id, false);
    });
  }

  function boxIdFromEvent(e: Event): string | null {
    const box = e.target instanceof HTMLElement
      ? e.target.closest<HTMLElement>('.region-box[data-region-id]')
      : null;
    const id = box?.dataset.regionId;
    return id !== undefined && id !== 'pending' ? id : null;
  }

  // --- Event wiring (panel) -----------------------------------------------

  // Hover-link from a region list row back to its box on the image.
  panel.addEventListener('mouseover', (e) => {
    const id = regionRowIdFromEvent(e);
    if (id !== null) setHighlight(id, true);
  });
  panel.addEventListener('mouseout', (e) => {
    const id = regionRowIdFromEvent(e);
    if (id !== null) setHighlight(id, false);
  });

  function regionRowIdFromEvent(e: Event): string | null {
    const row = e.target instanceof HTMLElement
      ? e.target.closest<HTMLElement>('.image-feedback-item[data-id]')
      : null;
    const id = row?.dataset.id;
    if (id === undefined || id === 'pending') return null;
    return regions.some((r) => r.id === id) ? id : null;
  }

  panel.addEventListener('click', (e) => {
    const target = e.target;
    // `Element`, not `HTMLElement`: a click lands on the `<svg>`/`<path>` inside
    // an icon button (`SVGElement`), which `closest('[data-action]')` still
    // resolves correctly. The stricter guard silently dropped edit/delete/etc.
    // once the glyphs became lucide icons (GB-952 regression, caught by GB-956).
    if (!(target instanceof Element)) return;
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
      const category = generalCategory;
      generalCategory = DEFAULT_CATEGORY;
      // On failure, restore the composer so the typed comment isn't silently
      // lost (GB-1082): re-render, then put the text and category back.
      void addComment(text, category).then(renderAll).catch(() => {
        showToast('Saving the comment failed — your text was kept');
        generalCategory = category;
        renderAll();
        const restored = panel.querySelector<HTMLTextAreaElement>('[data-role="general-input"]');
        if (restored !== null) restored.value = text;
      });
    } else if (action === 'save-pending') {
      const input = panel.querySelector<HTMLTextAreaElement>('[data-role="pending-input"]');
      const text = input?.value.trim() ?? '';
      if (text === '' || pending === null) return;
      const region = pending;
      const category = pendingCategory;
      pending = null;
      pendingCategory = DEFAULT_CATEGORY;
      void addComment(text, category, region).then(renderAll).catch(() => {
        showToast('Saving the region comment failed — your text was kept');
        pending = region;
        pendingCategory = category;
        renderAll();
        const restored = panel.querySelector<HTMLTextAreaElement>('[data-role="pending-input"]');
        if (restored !== null) restored.value = text;
      });
    } else if (action === 'cancel-pending') {
      pending = null;
      pendingCategory = DEFAULT_CATEGORY;
      renderAll();
    } else if (action === 'pick-general-cat') {
      showCategoryPicker(actionEl, generalCategory, (value) => { generalCategory = value; renderPanel(); });
    } else if (action === 'pick-pending-cat') {
      showCategoryPicker(actionEl, pendingCategory, (value) => { pendingCategory = value; renderPanel(); });
    } else if (action === 'cycle-pending-side' && pending !== null) {
      pending = scopeRegion(pending, cycleScope(pending.side));
      renderAll();
    } else if (action === 'pick-category' && id !== undefined) {
      const current = regions.find((r) => r.id === id)?.category
        ?? comments.find((c) => c.id === id)?.category ?? DEFAULT_CATEGORY;
      showCategoryPicker(actionEl, current, (value) => {
        saveCategory(id, value).catch(() => { showToast('Saving the category failed'); renderAll(); });
      });
    } else if (action === 'cycle-side' && id !== undefined) {
      const region = regions.find((r) => r.id === id);
      if (region !== undefined) {
        saveScope(id, cycleScope(region.region.side)).catch(() => { showToast('Saving the region scope failed'); renderAll(); });
      }
    } else if (action === 'delete' && id !== undefined) {
      removeItem(id).catch(() => { showToast('Deleting the comment failed'); renderAll(); });
    } else if (action === 'edit' && itemEl !== null && id !== undefined) {
      beginInlineEdit(itemEl, id);
    } else if (action === 'save-edit' && itemEl !== null && id !== undefined) {
      const input = itemEl.querySelector<HTMLTextAreaElement>('[data-role="edit-input"]');
      const text = input?.value.trim() ?? '';
      if (text === '') return;
      saveEdit(id, text).catch(() => { showToast('Saving the edit failed'); renderAll(); });
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

// --- Per-side scope helpers -----------------------------------------------

function scopeRegion(r: ImageRegion, scope: RegionScope): ImageRegion {
  const base: ImageRegion = { x: r.x, y: r.y, w: r.w, h: r.h };
  return scope === undefined ? base : { ...base, side: scope };
}

/** Cycle a region's scope: both → A → B → both. */
function cycleScope(scope: RegionScope): RegionScope {
  if (scope === undefined) return 'old';
  if (scope === 'old') return 'new';
  return undefined;
}

function scopeLabel(scope: RegionScope): string {
  return scope === 'old' ? 'A' : scope === 'new' ? 'B' : 'A+B';
}

function scopeTitle(scope: RegionScope): string {
  if (scope === 'old') return 'Applies to the A (old) image only — click to change';
  if (scope === 'new') return 'Applies to the B (new) image only — click to change';
  return 'Applies to both images — click to change';
}

// --- JSX views ------------------------------------------------------------

function categoryBadgeJsx(category: string, action: string): SafeHtml {
  const cat = CATEGORIES.find((c) => c.value === category);
  return (
    <button type="button" className={`annotation-category category-${category} image-feedback-cat`}
      data-action={action} data-category={category} title="Change category">
      {cat ? cat.label : category}
    </button>
  );
}

function scopeBadgeJsx(scope: RegionScope, action: string): SafeHtml {
  return (
    <button type="button" className={`image-feedback-side side-${scope ?? 'both'}`}
      data-action={action} title={scopeTitle(scope)}>
      {scopeLabel(scope)}
    </button>
  );
}

function regionBoxJsx(region: ImageRegion, number: number, id: string, isPending: boolean): SafeHtml {
  const s = regionStyle(region);
  const scope = region.side;
  const cls = [
    'region-box',
    isPending ? 'region-box-pending' : '',
    scope === 'old' ? 'region-box-a' : scope === 'new' ? 'region-box-b' : '',
  ].filter(Boolean).join(' ');
  const badge = scope !== undefined ? `${String(number)} ${scopeLabel(scope)}` : String(number);
  return (
    <div className={cls} data-region-id={id}
      style={`left:${s.left};top:${s.top};width:${s.width};height:${s.height}`}>
      <span className="region-badge">{badge}</span>
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
      {categoryBadgeJsx(c.category, 'pick-category')}
      <div className="image-feedback-item-body" data-role="item-body">
        <span className="image-feedback-text">{c.content}</span>
      </div>
      <div className="image-feedback-item-actions">
        <button className="btn btn-xs btn-icon" data-action="attach" title="Attach a file"><IconPaperclip /></button>
        <button className="btn btn-xs btn-icon" data-action="edit" title="Edit"><IconEdit /></button>
        <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete"><IconTrash /></button>
      </div>
      <div className="annotation-attachments" data-att-list={c.id}></div>
    </li>
  );
}

function regionItemJsx(r: RegionItem, number: number): SafeHtml {
  return (
    <li className="image-feedback-item" data-id={r.id}>
      <span className="region-badge region-badge-list">{String(number)}</span>
      {scopeBadgeJsx(r.region.side, 'cycle-side')}
      {categoryBadgeJsx(r.category, 'pick-category')}
      <div className="image-feedback-item-body" data-role="item-body">
        <span className="image-feedback-region-pct">{formatRegionPct(r.region)}</span>
        <span className="image-feedback-text">{r.content}</span>
      </div>
      <div className="image-feedback-item-actions">
        <button className="btn btn-xs btn-icon" data-action="attach" title="Attach a file"><IconPaperclip /></button>
        <button className="btn btn-xs btn-icon" data-action="edit" title="Edit"><IconEdit /></button>
        <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete"><IconTrash /></button>
      </div>
      <div className="annotation-attachments" data-att-list={r.id}></div>
    </li>
  );
}

function pendingRegionItemJsx(number: number, scope: RegionScope, category: string): SafeHtml {
  return (
    <li className="image-feedback-item image-feedback-item-pending" data-id="pending">
      <span className="region-badge region-badge-list">{String(number)}</span>
      {scopeBadgeJsx(scope, 'cycle-pending-side')}
      {categoryBadgeJsx(category, 'pick-pending-cat')}
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
  pending: ImageRegion | null,
  generalCategory: string,
  pendingCategory: string,
): SafeHtml {
  const hasPending = pending !== null;
  return (
    <div className="image-feedback-inner">
      <div className="image-feedback-bar">
        <button className={`btn btn-sm image-feedback-draw-btn ${drawMode ? 'active' : ''}`} data-action="toggle-draw">
          {drawMode ? 'Drawing…' : <><IconSquareDashed /> Draw region</>}
        </button>
        <span className="image-feedback-hint">
          {drawMode ? 'Drag a rectangle on the image to mark a region' : 'Comment on this image, or draw a region to anchor a comment'}
        </span>
      </div>

      <div className="image-feedback-section">
        <div className="image-feedback-heading">General comments</div>
        <div className="image-feedback-composer">
          {categoryBadgeJsx(generalCategory, 'pick-general-cat')}
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
            {pending !== null && pendingRegionItemJsx(regions.length + 1, pending.side, pendingCategory)}
          </ul>
        )}
      </div>
    </div>
  );
}
