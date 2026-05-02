import { bindServerAnnotations } from '../annotations/events.js';
import { api } from '../api.js';
import { updateProgress } from '../review/progress.js';
import { renderFileList } from '../sidebar/fileTree.js';
import { state } from '../state.js';
import { renderAINotes } from './aiNotes.js';
import { bindDragDrop } from './dragDrop.js';
import { applyHighlighting,detectLanguage } from './highlight.js';
import { bindHunkExpanders } from './hunkExpander.js';
import { bindImageDiff } from './imageDiff/index.js';
import { bindDiffLineClicks } from './lineClicks.js';
import { navPush } from './navStack.js';
import { loadOutline } from './outline.js';
import { syncSplitColumnHeights } from './splitSync.js';

export async function selectFile(fileId: string) {
  state.currentFileId = fileId;
  const file = state.files.find(f => f.id === fileId);
  navPush({ fileId, filePath: file?.file_path ?? null, scrollLine: 1 });
  updateNavFilePath(file?.file_path ?? '');
  document.querySelectorAll('.file-item').forEach(el => {
    (el as HTMLElement).classList.toggle('active', (el as HTMLElement).dataset.fileId === fileId);
  });

  const container = document.getElementById('diff-container');
  if (container === null) return;
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

  // Determine if this is an SVG file (from state, before fetch)
  const filePath = file?.file_path ?? '';
  const isSvg = filePath.toLowerCase().endsWith('.svg');
  const svgRendered = isSvg && state.svgViewMode === 'rendered';

  // Build fetch URL
  let params = '?mode=' + state.diffMode + (state.ignoreWhitespace ? '&ignoreWhitespace=1' : '');
  if (svgRendered) params += '&view=rendered';
  const res = await fetch('/file/' + fileId + params);
  container.innerHTML = await res.text();

  container.classList.toggle('wrap-lines', state.wrapLines);

  // Bind reveal button
  container.querySelector<HTMLElement>('.reveal-btn')?.addEventListener('click', (e) => {
    const fid = ((e.currentTarget as HTMLElement).dataset.fileId) ?? '';
    void api('/files/' + fid + '/reveal', { method: 'POST' });
  });

  // Mark as reviewed on first visit
  if (file !== undefined && file.status === 'pending') {
    await api('/files/' + fileId + '/status', { method: 'PATCH', body: { status: 'reviewed' } });
    file.status = 'reviewed';
    renderFileList();
    updateProgress();
  }

  // SVG toggle visibility + active state
  if (svgToggle) {
    svgToggle.style.display = isSvg ? '' : 'none';
    svgToggle.querySelectorAll('[data-svg-mode]').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.svgMode === state.svgViewMode);
    });
  }
  toolbar?.classList.toggle('svg-file', isSvg);

  // Determine what's in the container after fetch
  const imageDiffEl = container.querySelector<HTMLElement>('.image-diff');
  const isImageView = imageDiffEl !== null;

  // Show appropriate toolbar section
  if (textToolbar) textToolbar.style.display = isImageView ? 'none' : '';
  if (imageToolbar) imageToolbar.style.display = isImageView ? '' : 'none';

  if (isImageView) {
    // Image view: adapt toolbar segments and bind image diff
    if (imageToolbar) {
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
      let mode = state.lastImageMode;
      if (!hasComparison && (mode === 'difference' || mode === 'slice')) mode = 'image';
      if (hasComparison && mode === 'image') mode = 'slice';
      imageToolbar.querySelectorAll('[data-image-mode]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.imageMode === mode));
      container.querySelectorAll('.image-diff-panel').forEach(p => p.classList.toggle('active', (p as HTMLElement).dataset.panel === mode));
    }
    bindImageDiff();
  } else {
    // Text/code view: syntax highlighting, outline, annotations
    const diffView = container.querySelector<HTMLElement>('.diff-view');
    const dvPath = diffView?.dataset.filePath ?? '';
    state._detectedLang = detectLanguage(dvPath);
    if (state.highlightAuto) state.highlightLang = state._detectedLang;
    applyHighlighting();
    updateToolbarLanguage();
    syncSplitColumnHeights();

    void loadOutline(fileId);
    bindDiffLineClicks();
    bindHunkExpanders();
    bindDragDrop();
    bindServerAnnotations();
  }

  // Show AI notes if available
  const hasNotes = (state.sortMode !== 'folder' && fileId in state.fileNotes) ||
    (state.guidedReviewEnabled && fileId in state.guidedNotes);
  if (hasNotes) {
    renderAINotes(container, fileId);
  }
}

export function updateNavFilePath(filePath: string) {
  const el = document.getElementById('nav-file-path');
  if (el) el.textContent = filePath;
}

export function updateToolbarLanguage() {
  const btn = document.getElementById('language-btn');
  if (btn === null) return;
  if (state.highlightAuto) {
    const detected = state._detectedLang === 'plaintext' ? 'Plain Text' : state._detectedLang;
    btn.textContent = 'Auto (' + detected + ')';
  } else {
    btn.textContent = state.highlightLang === 'plaintext' ? 'Plain Text' : state.highlightLang;
  }
}
