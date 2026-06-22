import { delegate, delegateCapture, effect, mount, raw, signal } from 'kerfjs';

import { discardReviewNote, moveAnnotation, revealFile } from '../../api/index.js';
import { hydrateAttachments } from '../annotations/attachments.js';
import { bindAnnotationEvents } from '../annotations/events.js';
import { bindCreateFormEvents, showAnnotationForm } from '../annotations/form.js';
import { asEl, asElement } from '../dom.js';
import { aiStore, diffViewStore, dragStore, reviewStore } from '../stores/index.js';
import { renderAINotes } from './aiNotes.js';
import { applyHighlighting, detectLanguage } from './highlight.js';
import { handleHunkExpand } from './hunkExpander.js';
import { bindImageDiff } from './imageDiff/index.js';
import { loadOutline } from './outline.js';
import { selectFile } from './selection.js';
import { syncSplitColumnHeights } from './splitSync.js';

const DRAG_THRESHOLD = 5; // pixels — movement beyond this is a text selection, not a click

interface DiffContent {
  generation: number;
  fileId: string | null;
  filePath: string | null;
  html: string;
  kind: 'text' | 'image' | 'empty' | 'raw' | 'error';
}

// Shown in the diff pane when a `/file/:id` fetch fails outright (server down /
// network error / non-OK status) instead of silently leaving the previous
// file's diff in place. See the fetch effect's catch.
const DIFF_LOAD_ERROR_HTML =
  '<div class="diff-load-error">Couldn’t load this file — the server may be unavailable, or the file may have changed. Select the file again to retry.</div>';

const diffContentSignal = signal<DiffContent>({ generation: 0, fileId: null, filePath: null, html: '', kind: 'empty' });
let fetchGen = 0;

export function initDiffView(): void {
  const container = document.getElementById('diff-container');
  if (container === null) return;

  setupFetchEffect();
  setupMount(container);
  setupAINotesEffect(container);
  setupImageModeEffect();
  setupWrapClassEffect(container);
  setupDelegatedHandlers(container);
  bindAnnotationEvents(container);
  bindCreateFormEvents(container);
}

// --- Reactive fetch ---

let lastFetchKey = '';
// Incremented by `invalidateDiffCache()` to force the next fetch-effect run
// to actually fetch, even if the dedupe key is unchanged. The effect reads
// this signal so the read counts as a subscription.
const refetchTrigger = signal(0);

function setupFetchEffect(): void {
  effect(() => {
    void refetchTrigger.value; // subscribe so `invalidateDiffCache()` fires this effect
    const fileId = reviewStore.state.value.currentFileId;
    if (fileId === null) {
      if (lastFetchKey === '') return;
      lastFetchKey = '';
      diffContentSignal.value = { generation: ++fetchGen, fileId: null, filePath: null, html: '', kind: 'empty' };
      return;
    }
    const { diffMode, ignoreWhitespace, svgViewMode } = diffViewStore.state.value;
    const file = reviewStore.state.value.files.find(f => f.id === fileId);
    const isSvg = file?.file_path.toLowerCase().endsWith('.svg') ?? false;
    const svgRendered = isSvg && svgViewMode === 'rendered';

    // Dedupe against the LAST set of fetch params. The fetch effect
    // subscribes to `diffViewStore` and `reviewStore` (it reads multiple
    // fields off each), so writes to unrelated fields — `detectedLang` /
    // `highlightLang` from `runPostRender`, `annotationCounts` from
    // annotation actions, etc. — fire the effect even though no fetch
    // dep actually changed. Without this guard the effect re-fetched on
    // every store write, replaced the mount tree on every fetch result,
    // and clobbered any DOM the user had imperatively inserted (open
    // annotation forms, the language picker popup). Net result: visible
    // flicker + click-through impossible.
    const key = fileId + '|' + diffMode + '|' + String(ignoreWhitespace) + '|' + String(svgRendered);
    if (key === lastFetchKey) return;
    lastFetchKey = key;

    let params = '?mode=' + diffMode + (ignoreWhitespace ? '&ignoreWhitespace=1' : '');
    if (svgRendered) params += '&view=rendered';

    const myGen = ++fetchGen;
    void (async () => {
      try {
        const res = await fetch('/file/' + fileId + params);
        if (!res.ok) throw new Error(`/file/${fileId} returned ${String(res.status)}`);
        const html = await res.text();
        if (myGen !== fetchGen) return; // newer fetch in flight
        const kind: DiffContent['kind'] = html.includes('class="image-diff"') ? 'image' : 'text';
        diffContentSignal.value = { generation: myGen, fileId, filePath: null, html, kind };
      } catch {
        if (myGen !== fetchGen) return; // newer fetch in flight — let it win
        // Surface the failure instead of leaving the prior diff frozen in place.
        // Clear the dedupe key so re-selecting another file (then this one) retries.
        lastFetchKey = '';
        diffContentSignal.value = { generation: myGen, fileId, filePath: null, html: DIFF_LOAD_ERROR_HTML, kind: 'error' };
      }
    })();
  });
}

// --- Mount + post-render setup ---

function setupMount(container: HTMLElement): void {
  let lastGeneration = -1;
  mount(container, () => {
    const { generation, html, kind } = diffContentSignal.value;
    if (kind === 'empty') return raw('');
    // The fetched HTML is owned by the server template + imperative widgets
    // (highlight.js, hunk expansion, image zoom/slice). `data-morph-skip`
    // keeps kerf from touching the subtree on re-renders that share the same
    // generation key. A bump to `generation` produces a fresh element, which
    // is how a file/mode/whitespace switch replaces the tree.
    return (
      <div className="diff-content" data-key={`gen-${String(generation)}`} data-morph-skip>
        {/* eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- server-rendered HTML from /file/:id or /file-raw; trusted source */}
        {raw(html)}
      </div>
    );
  });

  // Post-render: highlight, outline, AI notes, server-annotation event
  // binding, etc. The mount effect runs synchronously before this one (it was
  // registered first), so by the time we get here the DOM is up-to-date.
  //
  // The effect intentionally subscribes only to `diffContentSignal` —
  // `runPostRender` reads `reviewStore` and `diffViewStore`
  // internally (and transitively via `applyHighlighting`,
  // `loadOutline`, etc.), and kerf's reactivity tracker traverses signal
  // reads through function calls during effect execution. Calling
  // `runPostRender` synchronously here would silently subscribe this effect
  // to every read inside that whole subtree, which means it'd re-fire on
  // every annotation count update, sort-mode flip, file-note write, etc.
  // Today the `generation === lastGeneration` guard short-circuits before
  // any of that work runs, so it's a cheap no-op — but the dependency is
  // invisible from this call site and would break if a future edit moved a
  // side-effect above the guard. `queueMicrotask` defers `runPostRender` to
  // a fresh execution context outside the effect's tracking scope, so the
  // reads inside it never enter the dependency graph. The DOM is already
  // up-to-date when the microtask runs — same flush burst as the rest of
  // mount's effect cycle, just one tick later.
  effect(() => {
    const content = diffContentSignal.value;
    if (content.kind === 'empty') return;
    if (content.kind !== 'raw' && content.fileId === null) return;
    if (content.generation === lastGeneration) return;
    lastGeneration = content.generation;
    queueMicrotask(() => { runPostRender(container, content); });
  });
}

function runPostRender(container: HTMLElement, content: DiffContent): void {
  const { fileId, filePath, kind } = content;
  if (kind === 'empty') return;
  // A failed fetch: just show the inline error message; no toolbar, highlight,
  // outline, or annotation binding (there's no diff to operate on).
  if (kind === 'error') {
    const welcome = document.querySelector<HTMLElement>('.welcome-message');
    if (welcome !== null) welcome.style.display = 'none';
    container.style.display = 'block';
    container.style.flexDirection = '';
    const toolbar = document.getElementById('diff-toolbar');
    if (toolbar !== null) toolbar.style.display = 'none';
    return;
  }
  // Header/toolbar visibility. Image diffs lay the container out as a flex
  // column so the canvas fills the space down to the toolbar (the slice
  // handles are pinned to the canvas edges, so an overshooting canvas would
  // hide the bottom handle under the toolbar — GB-823). Text/raw diffs stay
  // block so they scroll normally. The CSS chain under `:has(.image-diff)`
  // takes over from here; setting display here (vs CSS) is required because
  // this inline style would otherwise override it.
  const welcome = document.querySelector<HTMLElement>('.welcome-message');
  if (welcome !== null) welcome.style.display = 'none';
  if (kind === 'image') {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
  } else {
    container.style.display = 'block';
    container.style.flexDirection = '';
  }
  const navBar = document.getElementById('diff-nav-bar');
  if (navBar) navBar.style.display = '';
  const toolbar = document.getElementById('diff-toolbar');
  if (toolbar !== null) toolbar.style.display = '';

  const textToolbar = toolbar?.querySelector<HTMLElement>('.diff-toolbar-text');
  const imageToolbar = toolbar?.querySelector<HTMLElement>('.diff-toolbar-image');
  const svgToggle = toolbar?.querySelector<HTMLElement>('.diff-toolbar-svg-toggle');

  const file = fileId !== null ? reviewStore.state.value.files.find(f => f.id === fileId) : undefined;
  const effectiveFilePath = file?.file_path ?? filePath ?? '';
  // SVG toggle only applies to in-review files (raw views don't have a paired SVG diff).
  const isSvg = kind !== 'raw' && effectiveFilePath.toLowerCase().endsWith('.svg');
  if (svgToggle) {
    svgToggle.style.display = isSvg ? '' : 'none';
    const svgMode = diffViewStore.state.value.svgViewMode;
    svgToggle.querySelectorAll('[data-svg-mode]').forEach(btn => {
      btn.classList.toggle('active', asEl(btn).dataset.svgMode === svgMode);
    });
  }
  toolbar?.classList.toggle('svg-file', isSvg);

  if (textToolbar) textToolbar.style.display = kind === 'image' ? 'none' : '';
  if (imageToolbar) imageToolbar.style.display = kind === 'image' ? '' : 'none';

  if (kind === 'image') {
    adaptImageToolbar(container, imageToolbar);
    bindImageDiff();
  } else {
    const diffView = container.querySelector<HTMLElement>('.diff-view');
    const dvPath = diffView?.dataset.filePath ?? effectiveFilePath;
    const detectedLang = detectLanguage(dvPath);
    diffViewStore.actions.update({
      detectedLang,
      ...(diffViewStore.state.value.highlightAuto ? { highlightLang: detectedLang } : {}),
    });
    applyHighlighting();
    updateToolbarLanguage();
    syncSplitColumnHeights();
    // Outline keys off a real review file; skip for raw views.
    if (kind === 'text' && fileId !== null) void loadOutline(fileId);
    // Annotation events are registered once via `bindAnnotationEvents()` —
    // they fire for server-rendered annotation rows by `data-action` match.
    // Fill each annotation row's attachment chips (doc 25). The rows are
    // server-rendered with empty `[data-att-list]` containers; one bulk fetch
    // populates them all.
    void hydrateAttachments(container);
  }

  // Inline AI notes (risk / narrative / guided) are rendered reactively by
  // `setupAINotesEffect`, not here — they depend on the sort mode and guided
  // toggle, which change without re-fetching the diff. See GB-913.
}

// --- Reactive inline AI notes (risk / narrative / guided) ---

// The risk/narrative/guided notes that render inline in the diff depend on the
// AI sort mode and the guided-review toggle — neither of which is part of the
// diff fetch key, so a sort-mode flip leaves the diff DOM (and thus the
// generation) untouched. Before GB-913 the notes were only drawn from
// `runPostRender`, which runs only on a generation bump (file / split-unified /
// whitespace / SVG switch), so switching folder → risk → narrative didn't
// redraw the notes until the user toggled split/unified to force a refetch.
// This effect subscribes to the AI store so the notes follow the sort mode, and
// re-runs on diff (re)render too, so a file switch still draws them.
function setupAINotesEffect(container: HTMLElement): void {
  effect(() => {
    const content = diffContentSignal.value;
    // Subscribe to the inputs that decide which inline notes show. Reading the
    // store value subscribes the effect to every AI-store write; the refresh is
    // cheap and idempotent (it clears before rendering), so over-firing during
    // analysis polling is harmless.
    const ai = aiStore.state.value;
    void ai.sortMode;
    void ai.guidedReviewEnabled;
    if (content.kind !== 'text' && content.kind !== 'image') return;
    const fileId = content.fileId;
    if (fileId === null) return;
    // Defer to a microtask so the mount has finished (re)building the diff DOM
    // before we query it — same ordering contract as `runPostRender`.
    queueMicrotask(() => { refreshAINotes(container, fileId); });
  });
}

// Clear the previously-injected inline AI notes, then redraw the set that
// applies to the current sort mode / guided state. Clearing makes this
// idempotent (safe to call on every relevant change) and prevents a stale set
// from a prior mode lingering — e.g. risk notes hanging around after switching
// to narrative or folder. Only the client-injected notes are removed; the
// server-rendered `.pr-notes/` review notes (`.ai-note-review`) and human
// annotation/reply rows (`.annotation-row`) are left untouched.
function refreshAINotes(container: HTMLElement, fileId: string): void {
  container.querySelectorAll('.ai-note-overview, .ai-note-row').forEach(el => {
    if (!el.classList.contains('ai-note-review')) el.remove();
  });
  const ai = aiStore.state.value;
  const hasNotes = (ai.sortMode !== 'folder' && fileId in ai.fileNotes)
    || (ai.guidedReviewEnabled && fileId in ai.guidedNotes);
  if (hasNotes) renderAINotes(container, fileId);
}

/** Imperatively render a raw repo file (used by go-to-definition for files
 *  not in the review). Keeps the mount-as-source-of-truth invariant intact —
 *  no callsite touches `#diff-container.innerHTML` directly. */
export function setRawDiffContent(filePath: string, html: string): void {
  // The fetch effect's early-return path (`fileId === null && lastFetchKey === ''`)
  // is what keeps it from clobbering us. Pre-set the key so when the caller
  // updates `currentFileId` to null (which fires the fetch effect), it returns
  // without writing `empty` over our raw content.
  lastFetchKey = '';
  diffContentSignal.value = {
    generation: ++fetchGen,
    fileId: null,
    filePath,
    html,
    kind: 'raw',
  };
}

/** Resolve the stored image mode to one that exists for THIS file. A single-side
 *  image (added/deleted) has no comparison panels, so difference/slice/side-by-side
 *  fall back to the single "image" viewer; a two-sided file maps the single
 *  "image" mode to the side-by-side default. */
function effectiveImageMode(imageDiffEl: HTMLElement, storeMode: string): string {
  const hasComparison = imageDiffEl.dataset.hasOld === 'true' && imageDiffEl.dataset.hasNew === 'true';
  let mode = storeMode;
  if (!hasComparison && (mode === 'difference' || mode === 'slice' || mode === 'side-by-side')) mode = 'image';
  if (hasComparison && mode === 'image') mode = 'side-by-side';
  return mode;
}

/** Apply the active image comparison mode to the toolbar + panels. The
 *  side-by-side orientation sub-control is shown only while that mode is active. */
function applyImageMode(container: HTMLElement, imageToolbar: HTMLElement | null | undefined, mode: string): void {
  imageToolbar?.querySelectorAll('[data-image-mode]').forEach(b =>
    b.classList.toggle('active', asEl(b).dataset.imageMode === mode));
  container.querySelectorAll('.image-diff-panel').forEach(p =>
    p.classList.toggle('active', asEl(p).dataset.panel === mode));
  const orientControl = imageToolbar?.querySelector<HTMLElement>('[data-sxs-orient-control]');
  if (orientControl) orientControl.style.display = mode === 'side-by-side' ? '' : 'none';
}

/** Apply the side-by-side orientation (left-right / over-under) to the sub-control
 *  buttons and the panel — the panel's `data-sxs-orientation` drives the CSS flow. */
function applyImageOrientation(container: HTMLElement, imageToolbar: HTMLElement | null | undefined, orientation: string): void {
  imageToolbar?.querySelectorAll('[data-sxs-orient]').forEach(b =>
    b.classList.toggle('active', asEl(b).dataset.sxsOrient === orientation));
  const panel = container.querySelector<HTMLElement>('[data-panel="side-by-side"]');
  if (panel) panel.dataset.sxsOrientation = orientation;
}

function adaptImageToolbar(container: HTMLElement, imageToolbar: HTMLElement | null | undefined): void {
  if (imageToolbar == null) return;
  const imageDiffEl = container.querySelector<HTMLElement>('.image-diff');
  if (imageDiffEl === null) return;
  const hasComparison = imageDiffEl.dataset.hasOld === 'true' && imageDiffEl.dataset.hasNew === 'true';
  const sxsBtn = imageToolbar.querySelector<HTMLElement>('[data-image-mode="side-by-side"]');
  const diffBtn = imageToolbar.querySelector<HTMLElement>('[data-image-mode="difference"]');
  const sliceBtn = imageToolbar.querySelector<HTMLElement>('[data-image-mode="slice"]');
  const imageBtn = imageToolbar.querySelector<HTMLElement>('[data-image-mode="image"]');
  for (const btn of [sxsBtn, diffBtn, sliceBtn]) {
    if (btn) btn.style.display = hasComparison ? '' : 'none';
  }
  if (imageBtn) imageBtn.style.display = hasComparison ? 'none' : '';
  const mode = effectiveImageMode(imageDiffEl, diffViewStore.state.value.lastImageMode);
  applyImageMode(container, imageToolbar, mode);
  applyImageOrientation(container, imageToolbar, diffViewStore.state.value.sxsOrientation);
}

// --- Reactive image mode panel switching ---

function setupImageModeEffect(): void {
  effect(() => {
    const storeMode = diffViewStore.state.value.lastImageMode;
    const orientation = diffViewStore.state.value.sxsOrientation;
    const container = document.getElementById('diff-container');
    if (container === null) return;
    const imageDiffEl = container.querySelector<HTMLElement>('.image-diff');
    if (imageDiffEl === null) return;
    const imageToolbar = document.querySelector<HTMLElement>('.diff-toolbar-image');
    applyImageMode(container, imageToolbar, effectiveImageMode(imageDiffEl, storeMode));
    applyImageOrientation(container, imageToolbar, orientation);
  });
}

// --- Reactive wrap-lines class ---

function setupWrapClassEffect(container: HTMLElement): void {
  effect(() => {
    const wrapLines = diffViewStore.state.value.wrapLines;
    container.classList.toggle('wrap-lines', wrapLines);
  });
}

// --- Delegated event handlers (on the diff container root) ---

/** Read the line number + side from a `.diff-line` element, applying the
 *  old → new side fallback (clicks/drops on an old-side row that has a
 *  paired new-side line should annotate against the new file). Returns
 *  `null` when the line number is missing or unparseable. */
function readLineAndSide(el: HTMLElement): { line: number; side: string } | null {
  const num = parseInt(el.dataset.line ?? '0', 10);
  if (isNaN(num) || num === 0) return null;
  let side = el.dataset.side ?? 'new';
  let line = num;
  if (side === 'old' && el.dataset.newLine !== undefined && el.dataset.newLine !== '') {
    const newLine = parseInt(el.dataset.newLine, 10);
    if (!isNaN(newLine)) { line = newLine; side = 'new'; }
  }
  return { line, side };
}

function setupDelegatedHandlers(container: HTMLElement): void {
  // Reveal button (server-rendered for image-not-found etc.)
  void delegate(container, 'click', '.reveal-btn', (_e, btn) => {
    const fid = asEl(btn).dataset.fileId ?? '';
    void revealFile({ fileId: fid });
  });

  // Hunk expanders
  void delegate(container, 'click', '.hunk-separator', (_e, el) => {
    handleHunkExpand(asEl(el));
  });

  // Diff line click → annotation form
  const clickStart = { x: 0, y: 0 };
  void delegate(container, 'mousedown', '.diff-line', (e) => {
    const me = e as MouseEvent;
    clickStart.x = me.clientX;
    clickStart.y = me.clientY;
  });
  void delegate(container, 'click', '.diff-line', (e, line) => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey) return;
    const target = asElement(me.target);
    if (target.closest('.annotation-form-container') || target.closest('.annotation-row')) return;
    const dx = Math.abs(me.clientX - clickStart.x);
    const dy = Math.abs(me.clientY - clickStart.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) return;
    const el = asEl(line);
    const target_ = readLineAndSide(el);
    if (target_ !== null) showAnnotationForm(el, target_.line, target_.side);
  });

  // Reply to an AI review note (doc 20 threading) — open the annotation form
  // under the note, linked to its SARIF guid.
  void delegate(container, 'click', '.ai-note-reply-btn', (e, btn) => {
    e.stopPropagation();
    const btnEl = asEl(btn);
    const noteRow = btnEl.closest('.ai-note-row');
    const guid = noteRow?.getAttribute('data-note-id') ?? '';
    const line = parseInt(btnEl.dataset.line ?? '', 10);
    if (noteRow === null || guid === '' || isNaN(line)) return;
    showAnnotationForm(asEl(noteRow), line, 'new', guid);
  });

  // Keep an outdated (stale) review note — dismiss its flag for this session
  // (doc 20 §20.3, GB-907). Re-anchoring re-evaluates it on the next load.
  void delegate(container, 'click', '.ai-note-keep-btn', (e, btn) => {
    e.stopPropagation();
    const row = asEl(btn).closest('.ai-note-row');
    if (row === null) return;
    row.classList.remove('ai-note-stale');
    row.querySelector('.ai-note-stale-tag')?.remove();
    row.querySelector('.ai-note-stale-actions')?.remove();
  });

  // Discard an outdated review note — remove it from `.pr-notes/` and the DOM.
  void delegate(container, 'click', '.ai-note-discard-btn', (e, btn) => {
    e.stopPropagation();
    const row = asEl(btn).closest('.ai-note-row');
    if (row === null) return;
    const guid = row.getAttribute('data-note-id') ?? '';
    const file = container.querySelector('.diff-view')?.getAttribute('data-file-path') ?? '';
    row.remove(); // optimistic — the row goes regardless of the on-disk result
    if (guid !== '' && file !== '') void discardReviewNote({ guid, file });
  });

  // Drag-and-drop annotation onto a different line
  void delegate(container, 'dragover', '.diff-line', (e, line) => {
    if (dragStore.state.value.annotation === null) return;
    e.preventDefault();
    const dragEvent = e as DragEvent;
    if (dragEvent.dataTransfer !== null) dragEvent.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.diff-line.drag-over').forEach(d => { d.classList.remove('drag-over'); });
    asEl(line).classList.add('drag-over');
  });
  void delegate(container, 'dragleave', '.diff-line', (_e, line) => {
    asEl(line).classList.remove('drag-over');
  });
  void delegate(container, 'drop', '.diff-line', (e, line) => {
    e.preventDefault();
    container.querySelectorAll('.diff-line.drag-over').forEach(d => { d.classList.remove('drag-over'); });
    const drag = dragStore.state.value.annotation;
    if (drag === null) return;

    const dropTarget = readLineAndSide(asEl(line));
    if (dropTarget === null) return;

    dragStore.actions.setAnnotation(null);
    void (async () => {
      await moveAnnotation({ id: drag.id, lineNumber: dropTarget.line, side: dropTarget.side as 'old' | 'new' });
      // The server's diff HTML for this file now reflects the new
      // annotation position; the file ID hasn't changed, so the fetch
      // effect's dedupe would skip the refetch without this nudge.
      invalidateDiffCache();
      const currentFileId = reviewStore.state.value.currentFileId;
      if (currentFileId !== null) void selectFile(currentFileId);
    })();
  });

  // Scroll sync: split-mode side-by-side horizontal scroll
  delegateCaptureScroll(container);
}

function delegateCaptureScroll(container: HTMLElement): void {
  let lastScrollLeft = 0;
  let rafId: number | null = null;
  let syncing = false;
  // Scroll doesn't bubble, but `delegateCapture` registers the listener in the
  // capture phase. `target.matches('.code')` is the right semantics here —
  // we only want to react to scroll on a `.code` cell, not its container.
  void delegateCapture(container, 'scroll', '.code', (_e, target) => {
    const dv = diffViewStore.state.value;
    if (syncing || dv.wrapLines || dv.diffMode !== 'split') return;
    const el = asEl(target);
    if (!el.closest('.split-row') && !el.closest('.split-columns')) return;
    const scrollLeft = el.scrollLeft;
    if (scrollLeft === lastScrollLeft) return;
    lastScrollLeft = scrollLeft;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      syncing = true;
      container.querySelectorAll('.split-row .code, .split-columns .code').forEach(other => {
        if (other !== el && asEl(other).scrollLeft !== scrollLeft) {
          asEl(other).scrollLeft = scrollLeft;
        }
      });
      syncing = false;
    });
  });
}

export function updateToolbarLanguage(): void {
  const btn = document.getElementById('language-btn');
  if (btn === null) return;
  const dv = diffViewStore.state.value;
  if (dv.highlightAuto) {
    const detected = dv.detectedLang === 'plaintext' ? 'Plain Text' : dv.detectedLang;
    btn.textContent = 'Auto (' + detected + ')';
  } else {
    btn.textContent = dv.highlightLang === 'plaintext' ? 'Plain Text' : dv.highlightLang;
  }
}

export function updateNavFilePath(filePath: string): void {
  const el = document.getElementById('nav-file-path');
  if (el) el.textContent = filePath;
}

/** Force the next fetch-effect run to actually fetch, even if the
 *  `(fileId, diffMode, ignoreWhitespace, svgViewMode)` dedupe key is
 *  unchanged. Use after a server-side mutation that affects the diff —
 *  the refresh button (`/review/refresh`), an annotation drag-drop move,
 *  etc. */
export function invalidateDiffCache(): void {
  lastFetchKey = '';
  refetchTrigger.value = refetchTrigger.value + 1;
}

// Used by hunkExpander to trigger re-highlight/sync after surgical mutations.
export function postHunkExpand(): void {
  applyHighlighting();
  syncSplitColumnHeights();
}
