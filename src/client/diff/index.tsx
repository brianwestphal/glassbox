import { delegate, delegateCapture, effect, mount, raw, signal } from 'kerfjs';

import { moveAnnotation, revealFile } from '../../api/index.js';
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
  kind: 'text' | 'image' | 'empty' | 'raw';
}

const diffContentSignal = signal<DiffContent>({ generation: 0, fileId: null, filePath: null, html: '', kind: 'empty' });
let fetchGen = 0;

export function initDiffView(): void {
  const container = document.getElementById('diff-container');
  if (container === null) return;

  setupFetchEffect();
  setupMount(container);
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
      const res = await fetch('/file/' + fileId + params);
      const html = await res.text();
      if (myGen !== fetchGen) return; // newer fetch in flight
      const kind: DiffContent['kind'] = html.includes('class="image-diff"') ? 'image' : 'text';
      diffContentSignal.value = { generation: myGen, fileId, filePath: null, html, kind };
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
  // `runPostRender` reads `reviewStore`, `diffViewStore`, and `aiStore`
  // internally (and transitively via `renderAINotes`, `applyHighlighting`,
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
  // Header/toolbar visibility
  const welcome = document.querySelector<HTMLElement>('.welcome-message');
  if (welcome !== null) welcome.style.display = 'none';
  container.style.display = 'block';
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
    // Outline + AI notes both key off a real review file; skip for raw views.
    if (kind === 'text' && fileId !== null) void loadOutline(fileId);
    // Annotation events are registered once via `bindAnnotationEvents()` —
    // they fire for server-rendered annotation rows by `data-action` match.
  }

  // AI notes injection (independent of text/image, but only for in-review files)
  if (fileId !== null) {
    const ai = aiStore.state.value;
    const hasNotes = (ai.sortMode !== 'folder' && fileId in ai.fileNotes)
      || (ai.guidedReviewEnabled && fileId in ai.guidedNotes);
    if (hasNotes) renderAINotes(container, fileId);
  }
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

function adaptImageToolbar(container: HTMLElement, imageToolbar: HTMLElement | null | undefined): void {
  if (imageToolbar == null) return;
  const imageDiffEl = container.querySelector<HTMLElement>('.image-diff');
  if (imageDiffEl === null) return;
  const hasComparison = imageDiffEl.dataset.hasOld === 'true' && imageDiffEl.dataset.hasNew === 'true';
  const diffBtn = imageToolbar.querySelector<HTMLElement>('[data-image-mode="difference"]');
  const sliceBtn = imageToolbar.querySelector<HTMLElement>('[data-image-mode="slice"]');
  const imageBtn = imageToolbar.querySelector<HTMLElement>('[data-image-mode="image"]');
  if (hasComparison) {
    if (diffBtn) diffBtn.style.display = '';
    if (sliceBtn) sliceBtn.style.display = '';
    if (imageBtn) imageBtn.style.display = 'none';
  } else {
    if (diffBtn) diffBtn.style.display = 'none';
    if (sliceBtn) sliceBtn.style.display = 'none';
    if (imageBtn) imageBtn.style.display = '';
  }
  let mode = diffViewStore.state.value.lastImageMode;
  if (!hasComparison && (mode === 'difference' || mode === 'slice')) mode = 'image';
  if (hasComparison && mode === 'image') mode = 'slice';
  imageToolbar.querySelectorAll('[data-image-mode]').forEach(b =>
    b.classList.toggle('active', asEl(b).dataset.imageMode === mode));
  container.querySelectorAll('.image-diff-panel').forEach(p =>
    p.classList.toggle('active', asEl(p).dataset.panel === mode));
}

// --- Reactive image mode panel switching ---

function setupImageModeEffect(): void {
  effect(() => {
    const mode = diffViewStore.state.value.lastImageMode;
    const container = document.getElementById('diff-container');
    if (container === null) return;
    const imageDiffEl = container.querySelector<HTMLElement>('.image-diff');
    if (imageDiffEl === null) return;
    const imageToolbar = document.querySelector<HTMLElement>('.diff-toolbar-image');
    imageToolbar?.querySelectorAll('[data-image-mode]').forEach(b =>
      b.classList.toggle('active', asEl(b).dataset.imageMode === mode));
    container.querySelectorAll('.image-diff-panel').forEach(p =>
      p.classList.toggle('active', asEl(p).dataset.panel === mode));
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
