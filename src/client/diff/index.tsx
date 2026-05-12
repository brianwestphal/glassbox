import { delegate, delegateCapture, effect, mount, raw, signal } from 'kerfjs';

import { bindAnnotationEvents } from '../annotations/events.js';
import { bindCreateFormEvents, showAnnotationForm } from '../annotations/form.js';
import { api } from '../api.js';
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
  html: string;
  kind: 'text' | 'image' | 'empty';
}

const diffContentSignal = signal<DiffContent>({ generation: 0, fileId: null, html: '', kind: 'empty' });
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

function setupFetchEffect(): void {
  effect(() => {
    const fileId = reviewStore.state.value.currentFileId;
    if (fileId === null) {
      diffContentSignal.value = { generation: ++fetchGen, fileId: null, html: '', kind: 'empty' };
      return;
    }
    const { diffMode, ignoreWhitespace, svgViewMode } = diffViewStore.state.value;
    const file = reviewStore.state.value.files.find(f => f.id === fileId);
    const isSvg = file?.file_path.toLowerCase().endsWith('.svg') ?? false;
    const svgRendered = isSvg && svgViewMode === 'rendered';

    let params = '?mode=' + diffMode + (ignoreWhitespace ? '&ignoreWhitespace=1' : '');
    if (svgRendered) params += '&view=rendered';

    const myGen = ++fetchGen;
    void (async () => {
      const res = await fetch('/file/' + fileId + params);
      const html = await res.text();
      if (myGen !== fetchGen) return; // newer fetch in flight
      const kind: DiffContent['kind'] = html.includes('class="image-diff"') ? 'image' : 'text';
      diffContentSignal.value = { generation: myGen, fileId, html, kind };
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
        {raw(html)}
      </div>
    );
  });

  // Post-render: highlight, outline, AI notes, server-annotation event
  // binding, etc. The mount effect runs synchronously before this one (it was
  // registered first), so by the time we get here the DOM is up-to-date.
  effect(() => {
    const { generation, fileId, kind } = diffContentSignal.value;
    if (kind === 'empty' || fileId === null) return;
    if (generation === lastGeneration) return;
    lastGeneration = generation;
    runPostRender(container, fileId, kind);
  });
}

function runPostRender(container: HTMLElement, fileId: string, kind: 'text' | 'image'): void {
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

  const file = reviewStore.state.value.files.find(f => f.id === fileId);
  const filePath = file?.file_path ?? '';
  const isSvg = filePath.toLowerCase().endsWith('.svg');
  if (svgToggle) {
    svgToggle.style.display = isSvg ? '' : 'none';
    const svgMode = diffViewStore.state.value.svgViewMode;
    svgToggle.querySelectorAll('[data-svg-mode]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.svgMode === svgMode);
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
    const dvPath = diffView?.dataset.filePath ?? '';
    const detectedLang = detectLanguage(dvPath);
    diffViewStore.actions.update({
      detectedLang,
      ...(diffViewStore.state.value.highlightAuto ? { highlightLang: detectedLang } : {}),
    });
    applyHighlighting();
    updateToolbarLanguage();
    syncSplitColumnHeights();
    void loadOutline(fileId);
    // Annotation events are registered once via `bindAnnotationEvents()` —
    // they fire for server-rendered annotation rows by `data-action` match.
  }

  // AI notes injection (independent of text/image)
  const ai = aiStore.state.value;
  const hasNotes = (ai.sortMode !== 'folder' && fileId in ai.fileNotes)
    || (ai.guidedReviewEnabled && fileId in ai.guidedNotes);
  if (hasNotes) renderAINotes(container, fileId);
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
    b.classList.toggle('active', (b as HTMLElement).dataset.imageMode === mode));
  container.querySelectorAll('.image-diff-panel').forEach(p =>
    p.classList.toggle('active', (p as HTMLElement).dataset.panel === mode));
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
      b.classList.toggle('active', (b as HTMLElement).dataset.imageMode === mode));
    container.querySelectorAll('.image-diff-panel').forEach(p =>
      p.classList.toggle('active', (p as HTMLElement).dataset.panel === mode));
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

function setupDelegatedHandlers(container: HTMLElement): void {
  // Reveal button (server-rendered for image-not-found etc.)
  delegate(container, 'click', '.reveal-btn', (_e, btn) => {
    const fid = (btn as HTMLElement).dataset.fileId ?? '';
    void api('/files/' + fid + '/reveal', { method: 'POST' });
  });

  // Hunk expanders
  delegate(container, 'click', '.hunk-separator', (_e, el) => {
    handleHunkExpand(el as HTMLElement);
  });

  // Diff line click → annotation form
  const clickStart = { x: 0, y: 0 };
  delegate(container, 'mousedown', '.diff-line', (e) => {
    const me = e as MouseEvent;
    clickStart.x = me.clientX;
    clickStart.y = me.clientY;
  });
  delegate(container, 'click', '.diff-line', (e, line) => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey) return;
    const target = me.target as HTMLElement;
    if (target.closest('.annotation-form-container') || target.closest('.annotation-row')) return;
    const dx = Math.abs(me.clientX - clickStart.x);
    const dy = Math.abs(me.clientY - clickStart.y);
    if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) return;
    const el = line as HTMLElement;
    let num = parseInt(el.dataset.line ?? '0', 10);
    let side = el.dataset.side ?? 'new';
    if (side === 'old' && el.dataset.newLine !== undefined && el.dataset.newLine !== '') {
      const newLine = parseInt(el.dataset.newLine, 10);
      if (!isNaN(newLine)) { num = newLine; side = 'new'; }
    }
    if (!isNaN(num)) showAnnotationForm(el, num, side);
  });

  // Drag-and-drop annotation onto a different line
  delegate(container, 'dragover', '.diff-line', (e, line) => {
    if (dragStore.state.value.annotation === null) return;
    e.preventDefault();
    const dragEvent = e as DragEvent;
    if (dragEvent.dataTransfer !== null) dragEvent.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.diff-line.drag-over').forEach(d => { d.classList.remove('drag-over'); });
    (line as HTMLElement).classList.add('drag-over');
  });
  delegate(container, 'dragleave', '.diff-line', (_e, line) => {
    (line as HTMLElement).classList.remove('drag-over');
  });
  delegate(container, 'drop', '.diff-line', (e, line) => {
    e.preventDefault();
    container.querySelectorAll('.diff-line.drag-over').forEach(d => { d.classList.remove('drag-over'); });
    const drag = dragStore.state.value.annotation;
    if (drag === null) return;

    const el = line as HTMLElement;
    let num = parseInt(el.dataset.line ?? '0', 10);
    let side = el.dataset.side ?? 'new';
    if (isNaN(num)) return;
    if (side === 'old' && el.dataset.newLine !== undefined && el.dataset.newLine !== '') {
      const newLine = parseInt(el.dataset.newLine, 10);
      if (!isNaN(newLine)) { num = newLine; side = 'new'; }
    }

    dragStore.actions.setAnnotation(null);
    void (async () => {
      await api('/annotations/' + drag.id + '/move', {
        method: 'PATCH',
        body: { lineNumber: num, side: side },
      });
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
  delegateCapture(container, 'scroll', '.code', (_e, target) => {
    const dv = diffViewStore.state.value;
    if (syncing || dv.wrapLines || dv.diffMode !== 'split') return;
    const el = target as HTMLElement;
    if (!el.closest('.split-row') && !el.closest('.split-columns')) return;
    const scrollLeft = el.scrollLeft;
    if (scrollLeft === lastScrollLeft) return;
    lastScrollLeft = scrollLeft;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      syncing = true;
      container.querySelectorAll('.split-row .code, .split-columns .code').forEach(other => {
        if (other !== el && (other as HTMLElement).scrollLeft !== scrollLeft) {
          (other as HTMLElement).scrollLeft = scrollLeft;
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

// Used by hunkExpander to trigger re-highlight/sync after surgical mutations.
export function postHunkExpand(): void {
  applyHighlighting();
  syncSplitColumnHeights();
}
