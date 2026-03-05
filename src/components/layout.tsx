import { raw } from '../jsx-runtime.js';

export function Layout({ title, reviewId, children }: { title: string; reviewId: string; children?: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{raw(getStyles())}</style>
      </head>
      <body data-review-id={reviewId}>
        {children}
        <script>{raw(getClientScript())}</script>
      </body>
    </html>
  );
}

function getStyles(): string {
  return `
:root {
  --bg: #1e1e2e;
  --bg-surface: #252536;
  --bg-hover: #2d2d44;
  --bg-active: #363652;
  --text: #cdd6f4;
  --text-dim: #8888aa;
  --text-bright: #ffffff;
  --accent: #89b4fa;
  --accent-hover: #74a8fc;
  --green: #a6e3a1;
  --red: #f38ba8;
  --yellow: #f9e2af;
  --orange: #fab387;
  --blue: #89b4fa;
  --purple: #cba6f7;
  --teal: #94e2d5;
  --border: #363652;
  --diff-add-bg: rgba(166, 227, 161, 0.1);
  --diff-add-border: rgba(166, 227, 161, 0.3);
  --diff-remove-bg: rgba(243, 139, 168, 0.1);
  --diff-remove-border: rgba(243, 139, 168, 0.3);
  --diff-context-bg: transparent;
  --gutter-bg: #1a1a2e;
  --gutter-text: #555577;
  --sidebar-w: 300px;
  --radius: 6px;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  overflow: hidden;
}

.review-app {
  display: flex;
  height: 100vh;
}

/* Sidebar */
.sidebar {
  width: var(--sidebar-w);
  min-width: 200px;
  max-width: 60vw;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.sidebar-resize {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
}

.sidebar-resize:hover,
.sidebar-resize.dragging {
  background: var(--accent);
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.sidebar-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-bright);
}

.review-mode {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
  display: block;
}

.sidebar-controls {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
}

.diff-mode-toggle {
  display: flex;
  gap: 4px;
}

.file-filter {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
}

.file-filter-input {
  width: 100%;
  padding: 5px 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 12px;
  outline: none;
}

.file-filter-input:focus {
  border-color: var(--accent);
}

.file-filter-input::placeholder {
  color: var(--text-dim);
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* File list */
.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 6px 16px 6px 16px;
  cursor: pointer;
  font-size: 13px;
  gap: 8px;
  border-left: 3px solid transparent;
  transition: background 0.1s;
}

.file-item:hover { background: var(--bg-hover); }
.file-item.active { background: var(--bg-active); border-left-color: var(--accent); }

.file-item .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.file-item .status-dot.pending { background: var(--text-dim); }
.file-item .status-dot.reviewed { background: var(--green); }
.file-item .status-dot.skipped { background: var(--yellow); }

.file-item .file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
}

.file-item .file-status {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
}

.file-status.added { color: var(--green); background: rgba(166,227,161,0.1); }
.file-status.modified { color: var(--yellow); background: rgba(249,226,175,0.1); }
.file-status.deleted { color: var(--red); background: rgba(243,139,168,0.1); }
.file-status.renamed { color: var(--purple); background: rgba(203,166,247,0.1); }

.annotation-count {
  font-size: 11px;
  color: var(--accent);
  background: rgba(137,180,250,0.15);
  padding: 0 5px;
  border-radius: 8px;
  min-width: 18px;
  text-align: center;
}

/* Folder tree */
.folder-header {
  display: flex;
  align-items: center;
  padding: 4px 16px;
  font-size: 12px;
  color: var(--text-dim);
  gap: 4px;
  user-select: none;
}

.folder-header.collapsible {
  cursor: pointer;
}

.folder-header.collapsible:hover {
  color: var(--text);
}

.folder-header.collapsed + .folder-content {
  display: none;
}

.folder-arrow {
  width: 12px;
  font-size: 10px;
  flex-shrink: 0;
  text-align: center;
  transition: transform 0.1s;
}

.folder-header.collapsed .folder-arrow {
  transform: rotate(-90deg);
}

.folder-arrow-spacer {
  width: 12px;
  flex-shrink: 0;
}

.folder-name {
  font-family: var(--font-mono);
  font-size: 12px;
}

/* Main content */
.main-content {
  flex: 1;
  overflow: auto;
}

.welcome-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-dim);
  gap: 8px;
}

.welcome-message h3 { color: var(--text); }

/* Diff view */
.diff-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}

.diff-header .file-path {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-bright);
}

.diff-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Split diff */
.diff-table-split {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
}

.split-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.split-row .diff-line {
  display: flex;
  min-width: 0;
  overflow: hidden;
}

.split-row .diff-line.empty {
  background: var(--gutter-bg);
  min-height: 20px;
}

.split-row .gutter {
  width: 50px;
  min-width: 50px;
  padding: 0 6px;
  text-align: right;
  color: var(--gutter-text);
  background: var(--gutter-bg);
  user-select: none;
  font-size: 12px;
  flex-shrink: 0;
}

.split-left { border-right: 1px solid var(--border); }

.diff-table-split .hunk-separator {
  grid-column: 1 / -1;
}

.diff-line {
  display: flex;
  min-height: 20px;
  border-bottom: 1px solid rgba(54,54,82,0.3);
  cursor: pointer;
}

.diff-line:hover { filter: brightness(1.2); }

.diff-line.add { background: var(--diff-add-bg); }
.diff-line.remove { background: var(--diff-remove-bg); }
.diff-line.context { background: var(--diff-context-bg); }

.diff-line .gutter {
  width: 60px;
  min-width: 60px;
  padding: 0 8px;
  text-align: right;
  color: var(--gutter-text);
  background: var(--gutter-bg);
  user-select: none;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.diff-line .code {
  flex: 1;
  padding: 0 12px;
  white-space: pre;
  overflow-x: auto;
  tab-size: 4;
}

.diff-line.add .code::before { content: '+'; color: var(--green); margin-right: 4px; }
.diff-line.remove .code::before { content: '-'; color: var(--red); margin-right: 4px; }

/* Unified diff */
.diff-table-unified {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
}

.diff-table-unified .diff-line {
  display: flex;
  min-width: 0;
}

.diff-table-unified .gutter-old,
.diff-table-unified .gutter-new {
  width: 50px;
  min-width: 50px;
  padding: 0 6px;
  text-align: right;
  color: var(--gutter-text);
  background: var(--gutter-bg);
  user-select: none;
  font-size: 12px;
}

/* Hunk separator */
.hunk-separator {
  padding: 4px 16px;
  background: rgba(137,180,250,0.05);
  color: var(--text-dim);
  font-size: 12px;
  font-family: var(--font-mono);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.hunk-separator:hover { background: rgba(137,180,250,0.1); }

.expand-controls {
  display: flex;
  gap: 8px;
  padding: 2px 16px;
  background: rgba(137,180,250,0.05);
  border-bottom: 1px solid var(--border);
}

.expand-btn {
  font-size: 11px;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}

.expand-btn:hover { background: rgba(137,180,250,0.15); }

/* Annotation indicators */
.has-annotation .gutter {
  position: relative;
}

.has-annotation .gutter::after {
  content: '';
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

/* Annotation inline display */
.annotation-row {
  padding: 8px 16px 8px 76px;
  background: rgba(137,180,250,0.05);
  border-left: 3px solid var(--accent);
  font-family: var(--font-sans);
  font-size: 13px;
}

.annotation-row .annotation-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 4px 0;
}

.annotation-category {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  flex-shrink: 0;
}

.category-bug { color: var(--red); background: rgba(243,139,168,0.15); }
.category-fix { color: var(--orange); background: rgba(250,179,135,0.15); }
.category-style { color: var(--purple); background: rgba(203,166,247,0.15); }
.category-pattern-follow { color: var(--green); background: rgba(166,227,161,0.15); }
.category-pattern-avoid { color: var(--red); background: rgba(243,139,168,0.15); }
.category-note { color: var(--blue); background: rgba(137,180,250,0.15); }
.category-remember { color: var(--yellow); background: rgba(249,226,175,0.15); }

.annotation-text {
  flex: 1;
  color: var(--text);
  line-height: 1.4;
}

.annotation-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* Stale annotations */
.annotation-stale {
  opacity: 0.7;
}

.annotation-row:has(.annotation-stale) {
  border-left-color: var(--orange);
  background: rgba(250,179,135,0.05);
}

.btn-keep { color: var(--orange); }
.btn-keep:hover { background: rgba(250,179,135,0.15); }

.btn-icon { display: inline-flex; align-items: center; justify-content: center; padding: 3px 4px; }
.btn-icon svg { display: block; }

.annotation-category[data-action="reclassify"] { cursor: pointer; }
.annotation-category[data-action="reclassify"]:hover { filter: brightness(1.3); }

.reclassify-popup {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 4px 0;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  min-width: 140px;
}

.reclassify-option {
  padding: 6px 12px;
  cursor: pointer;
}

.reclassify-option:hover {
  background: var(--bg-hover);
}

.reclassify-option.active {
  background: rgba(137,180,250,0.1);
}

/* Stale indicator dot */
.stale-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--orange);
  flex-shrink: 0;
}

/* Drag handle */
.annotation-drag-handle {
  cursor: grab;
  color: var(--text-dim);
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
  user-select: none;
  padding: 0 2px;
}

.annotation-drag-handle:hover {
  color: var(--text);
}

/* Drop target highlight */
.diff-line.drag-over {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* Annotation form */
.annotation-form-container {
  padding: 12px 16px 12px 76px;
  background: rgba(137,180,250,0.08);
  border-left: 3px solid var(--accent);
}

.annotation-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-category-badge {
  cursor: pointer;
  align-self: flex-start;
}

.form-category-badge:hover {
  filter: brightness(1.3);
}

.annotation-form textarea {
  width: 100%;
  min-height: 60px;
  padding: 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-family: var(--font-sans);
  font-size: 13px;
  resize: vertical;
}

.annotation-form textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.annotation-form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* Buttons */
.btn {
  padding: 6px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}

.btn:hover { background: var(--bg-hover); }
.btn.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }

.btn-sm { padding: 3px 10px; font-size: 12px; }
.btn-xs { padding: 2px 6px; font-size: 11px; }

.btn-primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
  font-weight: 600;
}

.btn-primary:hover { background: var(--accent-hover); }

.btn-danger { color: var(--red); }
.btn-danger:hover { background: rgba(243,139,168,0.15); }

.btn-link {
  background: none;
  border: none;
  color: var(--accent);
  text-decoration: none;
  text-align: center;
}

.btn-link:hover { text-decoration: underline; }

/* History */
body:has(.history-page) {
  overflow: auto;
}

.history-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 40px 20px;
}

.history-page h1 { margin-bottom: 24px; }

.history-item {
  padding: 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 12px;
}

.history-item {
  position: relative;
}

.history-item h3 { font-size: 15px; margin-bottom: 4px; padding-right: 32px; }
.history-item .meta { font-size: 12px; color: var(--text-dim); }

.history-item .delete-review-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius);
  font-size: 16px;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.history-item:hover .delete-review-btn { opacity: 1; }
.history-item .delete-review-btn:hover { color: var(--red); background: rgba(243,139,168,0.15); }

.bulk-actions {
  display: flex;
  gap: 8px;
  margin: 12px 0;
  padding: 4px 0;
  align-items: center;
}

.bulk-actions span {
  font-size: 13px;
  color: var(--text-dim);
  margin-right: auto;
}

.status-badge {
  display: inline-block;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
}

.status-badge.in_progress, .status-badge.in-progress { color: var(--yellow); background: rgba(249,226,175,0.15); }
.status-badge.completed { color: var(--green); background: rgba(166,227,161,0.15); }

.history-item-link {
  text-decoration: none;
  color: inherit;
  display: block;
}

.history-item-link:hover .history-item {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.expanded-context {
  background: rgba(137,180,250,0.03);
}

/* Wrap mode */
.wrap-lines .code {
  white-space: pre-wrap !important;
  word-break: break-all;
  overflow-x: visible !important;
}

/* Hide horizontal scrollbars on code cells (still scrollable via trackpad) */
.diff-line .code {
  scrollbar-width: none;
}
.diff-line .code::-webkit-scrollbar {
  height: 0;
}

/* Controls layout */
.sidebar-controls-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.controls-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
}

/* Complete modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  max-width: 480px;
  width: 90%;
}

.modal h3 { margin-bottom: 12px; }
.modal p { margin-bottom: 16px; color: var(--text-dim); font-size: 14px; }

.modal-label { margin-bottom: 4px !important; font-size: 13px !important; color: var(--text-dim) !important; }

.modal-copyable {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
  background: var(--bg);
  padding: 8px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  margin-bottom: 16px;
  cursor: pointer;
  position: relative;
  word-break: break-all;
  transition: border-color 0.15s;
}

.modal-copyable:hover { border-color: var(--accent); }

.modal-copyable.copied::after {
  content: 'Copied!';
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--green);
  font-family: var(--font-sans);
}

.modal-gitignore {
  margin-bottom: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* Scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

/* Progress */
.progress-bar {
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  margin: 8px 16px;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}
`;
}

function getClientScript(): string {
  return `
(function() {
  const state = {
    reviewId: document.body.dataset.reviewId,
    currentFileId: null,
    diffMode: 'split',
    wrapLines: false,
    files: [],
    fileOrder: [],
    annotationCounts: {},
    staleCounts: {},
    filterText: '',
    _dragAnnotation: null,
  };

  const CATEGORIES = [
    { value: 'bug', label: 'Bug' },
    { value: 'fix', label: 'Fix needed' },
    { value: 'style', label: 'Style' },
    { value: 'pattern-follow', label: 'Pattern to follow' },
    { value: 'pattern-avoid', label: 'Pattern to avoid' },
    { value: 'note', label: 'Note' },
    { value: 'remember', label: 'Remember (for AI)' },
  ];

  // --- API ---
  async function api(path, opts = {}) {
    const separator = path.includes('?') ? '&' : '?';
    const url = '/api' + path + separator + 'reviewId=' + encodeURIComponent(state.reviewId);
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return res.json();
  }

  // --- Init ---
  async function init() {
    await loadFiles();
    bindSidebarEvents();
    bindDiffModeToggle();
    bindWrapToggle();
    bindFileFilter();
    bindSidebarResize();
    bindCompleteButton();
    bindReopenButton();
    initScrollSync();
    updateProgress();
    document.addEventListener('dragend', () => {
      state._dragAnnotation = null;
      document.querySelectorAll('.diff-line.drag-over').forEach(d => d.classList.remove('drag-over'));
    });
  }

  async function loadFiles() {
    const data = await api('/files');
    state.files = data.files;
    state.annotationCounts = data.annotationCounts;
    state.staleCounts = data.staleCounts || {};
    renderFileList();
  }

  function renderFileList() {
    var list = document.querySelector('.file-list-items');
    if (!list) return;
    list.innerHTML = '';
    state.fileOrder = [];
    var filtered = state.files;
    if (state.filterText) {
      var q = state.filterText.toLowerCase();
      filtered = state.files.filter(function(f) {
        return f.file_path.toLowerCase().indexOf(q) !== -1;
      });
    }
    var tree = buildFileTree(filtered);
    renderTreeNode(list, tree, 0);
  }

  function buildFileTree(files) {
    var root = { name: '', children: [], files: [] };
    files.forEach(function(f) {
      var parts = f.file_path.split('/');
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var child = node.children.find(function(c) { return c.name === parts[i]; });
        if (!child) {
          child = { name: parts[i], children: [], files: [] };
          node.children.push(child);
        }
        node = child;
      }
      node.files.push(f);
    });
    compressTree(root);
    return root;
  }

  function compressTree(node) {
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      while (child.children.length === 1 && child.files.length === 0) {
        var gc = child.children[0];
        child = { name: child.name + '/' + gc.name, children: gc.children, files: gc.files };
        node.children[i] = child;
      }
      compressTree(child);
    }
  }

  function countTreeFiles(node) {
    var count = node.files.length;
    node.children.forEach(function(c) { count += countTreeFiles(c); });
    return count;
  }

  function hasStaleInTree(node) {
    for (var i = 0; i < node.files.length; i++) {
      if (state.staleCounts[node.files[i].id]) return true;
    }
    for (var i = 0; i < node.children.length; i++) {
      if (hasStaleInTree(node.children[i])) return true;
    }
    return false;
  }

  function renderTreeNode(container, node, depth) {
    var sortedChildren = node.children.slice().sort(function(a, b) { return a.name.localeCompare(b.name); });

    sortedChildren.forEach(function(child) {
      var total = countTreeFiles(child);
      var isCollapsible = total > 1;

      var group = document.createElement('div');
      group.className = 'folder-group';

      var header = document.createElement('div');
      header.className = 'folder-header' + (isCollapsible ? ' collapsible' : '');
      header.style.paddingLeft = (16 + depth * 12) + 'px';
      var stale = hasStaleInTree(child);
      header.innerHTML =
        (isCollapsible ? '<span class="folder-arrow">\u25BE</span>' : '<span class="folder-arrow-spacer"></span>') +
        '<span class="folder-name">' + esc(child.name) + '/</span>' +
        (stale ? '<span class="stale-dot"></span>' : '');

      var content = document.createElement('div');
      content.className = 'folder-content';

      if (isCollapsible) {
        header.addEventListener('click', function() {
          header.classList.toggle('collapsed');
        });
      }

      renderTreeNode(content, child, depth + 1);

      group.appendChild(header);
      group.appendChild(content);
      container.appendChild(group);
    });

    node.files.forEach(function(f) {
      var diff = JSON.parse(f.diff_data || '{}');
      var el = document.createElement('div');
      el.className = 'file-item' + (f.id === state.currentFileId ? ' active' : '');
      el.dataset.fileId = f.id;
      el.style.paddingLeft = (16 + depth * 12) + 'px';
      var count = state.annotationCounts[f.id] || 0;
      var staleCount = state.staleCounts[f.id] || 0;
      var fileName = f.file_path.split('/').pop();
      el.innerHTML =
        '<span class="status-dot ' + f.status + '"></span>' +
        '<span class="file-name" title="' + esc(f.file_path) + '">' + esc(fileName) + '</span>' +
        '<span class="file-status ' + (diff.status || '') + '">' + (diff.status || '') + '</span>' +
        (staleCount ? '<span class="stale-dot"></span>' : '') +
        (count ? '<span class="annotation-count">' + count + '</span>' : '');
      el.addEventListener('click', function() { selectFile(f.id); });
      container.appendChild(el);
      state.fileOrder.push(f.id);
    });
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // --- File Selection ---
  async function selectFile(fileId) {
    state.currentFileId = fileId;
    document.querySelectorAll('.file-item').forEach(el => {
      el.classList.toggle('active', el.dataset.fileId === fileId);
    });

    const container = document.getElementById('diff-container');
    const welcome = document.querySelector('.welcome-message');
    if (welcome) welcome.style.display = 'none';
    container.style.display = 'block';

    const res = await fetch('/file/' + fileId + '?mode=' + state.diffMode);
    container.innerHTML = await res.text();

    // Reapply wrap mode
    container.classList.toggle('wrap-lines', state.wrapLines);

    // Mark file as reviewed
    const file = state.files.find(f => f.id === fileId);
    if (file && file.status === 'pending') {
      await api('/files/' + fileId + '/status', { method: 'PATCH', body: { status: 'reviewed' } });
      file.status = 'reviewed';
      renderFileList();
      updateProgress();
    }

    bindDiffLineClicks();
    bindHunkExpanders();
    bindDragDrop();
    bindServerAnnotations();
  }

  // --- Context Expansion ---
  function bindHunkExpanders() {
    document.querySelectorAll('.hunk-separator').forEach(el => {
      el.addEventListener('click', async () => {
        const fileId = document.querySelector('.diff-view')?.dataset?.fileId;
        if (!fileId) return;

        const hunkBlock = el.closest('.hunk-block');
        const prevBlock = hunkBlock?.previousElementSibling;

        // Determine the gap: from end of previous hunk to start of this hunk
        const newStart = parseInt(el.dataset.newStart, 10);
        let gapStart = 1;
        if (prevBlock) {
          const prevSep = prevBlock.querySelector('.hunk-separator');
          if (prevSep) {
            gapStart = parseInt(prevSep.dataset.newStart, 10) + parseInt(prevSep.dataset.newCount, 10);
          }
        }
        const gapEnd = newStart - 1;
        if (gapEnd < gapStart) return;

        const data = await api('/context/' + fileId + '?start=' + gapStart + '&end=' + gapEnd);
        if (!data.lines || !data.lines.length) return;

        // Build context lines and insert before the hunk separator
        const fragment = document.createDocumentFragment();
        data.lines.forEach(line => {
          const wrapper = document.createElement('div');
          const lineEl = document.createElement('div');
          lineEl.className = 'diff-line context expanded-context';
          lineEl.dataset.line = line.num;
          lineEl.dataset.side = 'new';

          if (state.diffMode === 'split') {
            lineEl.innerHTML =
              '<span class="gutter">' + line.num + '</span>' +
              '<span class="code">' + esc(line.content) + '</span>';
            const row = document.createElement('div');
            row.className = 'split-row';
            const leftEl = lineEl.cloneNode(true);
            leftEl.dataset.side = 'old';
            row.appendChild(leftEl);
            row.appendChild(lineEl);
            wrapper.appendChild(row);
          } else {
            lineEl.innerHTML =
              '<span class="gutter-old">' + line.num + '</span>' +
              '<span class="gutter-new">' + line.num + '</span>' +
              '<span class="code">' + esc(line.content) + '</span>';
            wrapper.appendChild(lineEl);
          }
          fragment.appendChild(wrapper);
        });

        el.replaceWith(fragment);
        bindDiffLineClicks();
      });
    });
  }

  // --- Diff Line Clicks ---
  function bindDiffLineClicks() {
    document.querySelectorAll('.diff-line').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.annotation-form-container') || e.target.closest('.annotation-row')) return;
        const line = parseInt(el.dataset.line, 10);
        const side = el.dataset.side || 'new';
        if (!isNaN(line)) showAnnotationForm(el, line, side);
      });
    });
  }

  function buildCategoryBadge(value) {
    var cat = CATEGORIES.find(function(c) { return c.value === value; });
    return '<span class="annotation-category category-' + esc(value) + ' form-category-badge" data-category="' + esc(value) + '">' + esc(cat ? cat.label : value) + '</span>';
  }

  function bindCategoryBadgeClick(container) {
    var badge = container.querySelector('.form-category-badge');
    if (!badge) return;
    badge.addEventListener('click', function(e) {
      e.stopPropagation();
      showCategoryPicker(badge);
    });
  }

  function showCategoryPicker(badge) {
    document.querySelectorAll('.reclassify-popup').forEach(function(el) { el.remove(); });

    var current = badge.dataset.category;
    var popup = document.createElement('div');
    popup.className = 'reclassify-popup';
    popup.innerHTML = CATEGORIES.map(function(c) {
      return '<div class="reclassify-option' + (c.value === current ? ' active' : '') + '" data-value="' + c.value + '">' +
        '<span class="annotation-category category-' + c.value + '">' + c.label + '</span>' +
      '</div>';
    }).join('');

    var rect = badge.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.zIndex = '1000';

    popup.addEventListener('click', function(e) {
      var opt = e.target.closest('.reclassify-option');
      if (!opt) return;
      e.stopPropagation();
      var val = opt.dataset.value;
      var cat = CATEGORIES.find(function(c) { return c.value === val; });
      badge.className = 'annotation-category category-' + val + ' form-category-badge';
      badge.dataset.category = val;
      badge.textContent = cat ? cat.label : val;
      popup.remove();
    });

    document.body.appendChild(popup);
    var closePopup = function(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closePopup, true);
      }
    };
    setTimeout(function() { document.addEventListener('click', closePopup, true); }, 0);
  }

  function showAnnotationForm(afterEl, lineNumber, side) {
    // Remove any existing form
    document.querySelectorAll('.annotation-form-container').forEach(el => el.remove());

    var defaultCategory = CATEGORIES[0].value;
    const container = document.createElement('div');
    container.className = 'annotation-form-container';
    container.innerHTML =
      '<div class="annotation-form">' +
        buildCategoryBadge(defaultCategory) +
        '<textarea placeholder="Enter your annotation..." autofocus></textarea>' +
        '<div class="annotation-form-actions">' +
          '<button class="btn btn-sm cancel-btn">Cancel</button>' +
          '<button class="btn btn-sm btn-primary annotation-save-btn">Save</button>' +
        '</div>' +
      '</div>';

    // Insert after the clicked line (or after its annotation rows)
    let insertAfter = afterEl;
    let next = afterEl.nextElementSibling;
    while (next && (next.classList.contains('annotation-row'))) {
      insertAfter = next;
      next = next.nextElementSibling;
    }
    insertAfter.parentNode.insertBefore(container, insertAfter.nextSibling);

    bindCategoryBadgeClick(container);

    container.querySelector('.cancel-btn').addEventListener('click', () => {
      container.remove();
    });

    const textarea = container.querySelector('textarea');
    textarea.focus();

    // Handle Cmd/Ctrl+Enter to save
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        saveAnnotation(container, lineNumber, side);
      }
      if (e.key === 'Escape') {
        container.remove();
      }
    });

    container.querySelector('.annotation-save-btn').addEventListener('click', () => {
      saveAnnotation(container, lineNumber, side);
    });
  }

  async function saveAnnotation(container, lineNumber, side) {
    const content = container.querySelector('textarea').value.trim();
    const category = container.querySelector('.form-category-badge').dataset.category;
    if (!content) return;

    const annotation = await api('/annotations', {
      method: 'POST',
      body: {
        reviewFileId: state.currentFileId,
        lineNumber,
        side,
        category,
        content,
      },
    });

    container.remove();
    renderAnnotationInline(annotation, lineNumber, side);

    // Update count
    state.annotationCounts[state.currentFileId] = (state.annotationCounts[state.currentFileId] || 0) + 1;
    renderFileList();
  }

  function renderAnnotationInline(annotation, lineNumber, side) {
    // Find the line element
    const lineEl = document.querySelector('.diff-line[data-line="' + lineNumber + '"][data-side="' + side + '"]');
    if (!lineEl) return;

    lineEl.classList.add('has-annotation');

    // Find or create annotation row after this line
    let annotationRow = lineEl.nextElementSibling;
    if (!annotationRow || !annotationRow.classList.contains('annotation-row')) {
      annotationRow = document.createElement('div');
      annotationRow.className = 'annotation-row';
      lineEl.parentNode.insertBefore(annotationRow, lineEl.nextSibling);
    }

    const item = document.createElement('div');
    item.className = 'annotation-item' + (annotation.is_stale ? ' annotation-stale' : '');
    item.dataset.annotationId = annotation.id;
    if (annotation.is_stale) item.dataset.isStale = 'true';
    item.innerHTML = buildAnnotationItemHtml(annotation);

    bindAnnotationItemEvents(item, annotation, lineEl, annotationRow);
    annotationRow.appendChild(item);
  }

  var ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  var ICON_EDIT = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';

  function buildAnnotationItemHtml(annotation) {
    return '<span class="annotation-drag-handle" draggable="true" title="Drag to move">\u2807</span>' +
      '<span class="annotation-category category-' + esc(annotation.category) + '" data-action="reclassify">' + esc(annotation.category) + '</span>' +
      '<span class="annotation-text">' + esc(annotation.content) + '</span>' +
      '<div class="annotation-actions">' +
        (annotation.is_stale ? '<button class="btn btn-xs btn-keep" data-action="keep">Keep</button>' : '') +
        '<button class="btn btn-xs btn-icon" data-action="edit" title="Edit">' + ICON_EDIT + '</button>' +
        '<button class="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete">' + ICON_TRASH + '</button>' +
      '</div>';
  }

  function bindAnnotationItemEvents(item, annotation, lineEl, annotationRow) {
    item.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api('/annotations/' + annotation.id, { method: 'DELETE' });
      item.remove();
      if (annotationRow && !annotationRow.querySelector('.annotation-item')) {
        annotationRow.remove();
        if (lineEl) lineEl.classList.remove('has-annotation');
      }
      state.annotationCounts[state.currentFileId] = Math.max(0, (state.annotationCounts[state.currentFileId] || 1) - 1);
      if (annotation.is_stale) {
        state.staleCounts[state.currentFileId] = Math.max(0, (state.staleCounts[state.currentFileId] || 1) - 1);
      }
      renderFileList();
    });

    item.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      editAnnotation(item, annotation);
    });

    // Double-click to edit
    item.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (item.querySelector('.annotation-form')) return;
      editAnnotation(item, annotation);
    });

    // Click category to reclassify
    item.querySelector('[data-action="reclassify"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showReclassifyPopup(e.target.closest('[data-action="reclassify"]'), item, annotation);
    });

    item.querySelector('[data-action="keep"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api('/annotations/' + annotation.id + '/keep', { method: 'POST' });
      annotation.is_stale = false;
      item.classList.remove('annotation-stale');
      delete item.dataset.isStale;
      item.innerHTML = buildAnnotationItemHtml(annotation);
      bindAnnotationItemEvents(item, annotation, lineEl, annotationRow);
      state.staleCounts[state.currentFileId] = Math.max(0, (state.staleCounts[state.currentFileId] || 1) - 1);
      renderFileList();
    });

    // Drag handle
    var handle = item.querySelector('.annotation-drag-handle');
    if (handle) {
      handle.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        state._dragAnnotation = { id: annotation.id, item: item, annotation: annotation };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', annotation.id);
      });
    }
  }

  function showReclassifyPopup(badge, item, annotation) {
    // Remove any existing popup
    document.querySelectorAll('.reclassify-popup').forEach(el => el.remove());

    var popup = document.createElement('div');
    popup.className = 'reclassify-popup';
    popup.innerHTML = CATEGORIES.map(function(c) {
      return '<div class="reclassify-option' + (c.value === annotation.category ? ' active' : '') + '" data-value="' + c.value + '">' +
        '<span class="annotation-category category-' + c.value + '">' + c.label + '</span>' +
      '</div>';
    }).join('');

    // Position near the badge
    var rect = badge.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.zIndex = '1000';

    popup.addEventListener('click', async (e) => {
      var opt = e.target.closest('.reclassify-option');
      if (!opt) return;
      e.stopPropagation();
      var newCategory = opt.dataset.value;
      if (newCategory === annotation.category) { popup.remove(); return; }
      annotation.category = newCategory;
      await api('/annotations/' + annotation.id, { method: 'PATCH', body: { content: annotation.content, category: newCategory } });
      item.innerHTML = buildAnnotationItemHtml(annotation);
      var row = item.closest('.annotation-row');
      var lineElRef = row ? row.previousElementSibling : null;
      bindAnnotationItemEvents(item, annotation, lineElRef, row);
      popup.remove();
    });

    document.body.appendChild(popup);

    // Close on outside click
    var closePopup = function(e) {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', closePopup, true);
      }
    };
    setTimeout(function() {
      document.addEventListener('click', closePopup, true);
    }, 0);
  }

  function editAnnotation(item, annotation) {
    var annotationRow = item.closest('.annotation-row');
    var formContainer = document.createElement('div');
    formContainer.className = 'annotation-form-container';
    formContainer.innerHTML =
      '<div class="annotation-form">' +
        buildCategoryBadge(annotation.category) +
        '<textarea>' + esc(annotation.content) + '</textarea>' +
        '<div class="annotation-form-actions">' +
          '<button class="btn btn-sm cancel-edit">Cancel</button>' +
          '<button class="btn btn-sm btn-primary save-edit">Save</button>' +
        '</div>' +
      '</div>';

    item.style.display = 'none';
    annotationRow.parentNode.insertBefore(formContainer, annotationRow.nextSibling);

    bindCategoryBadgeClick(formContainer);

    function cancelEdit() {
      item.style.display = '';
      formContainer.remove();
    }

    formContainer.querySelector('.cancel-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      cancelEdit();
    });

    formContainer.querySelector('.save-edit').addEventListener('click', async (e) => {
      e.stopPropagation();
      const content = formContainer.querySelector('textarea').value.trim();
      const category = formContainer.querySelector('.form-category-badge').dataset.category;
      if (!content) return;
      annotation.content = content;
      annotation.category = category;
      await api('/annotations/' + annotation.id, { method: 'PATCH', body: { content, category } });
      item.innerHTML = buildAnnotationItemHtml(annotation);
      rebindAnnotationActions(item, annotation);
      item.style.display = '';
      formContainer.remove();
    });

    const textarea = formContainer.querySelector('textarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        formContainer.querySelector('.save-edit').click();
      }
      if (e.key === 'Escape') {
        cancelEdit();
      }
    });
  }

  function rebindAnnotationActions(item, annotation) {
    var row = item.closest('.annotation-row');
    var lineEl = row ? row.previousElementSibling : null;
    bindAnnotationItemEvents(item, annotation, lineEl, row);
  }

  // --- Drag & Drop for Annotations ---
  function bindDragDrop() {
    document.querySelectorAll('.diff-line').forEach(el => {
      el.addEventListener('dragover', (e) => {
        if (!state._dragAnnotation) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.diff-line.drag-over').forEach(d => d.classList.remove('drag-over'));
        el.classList.add('drag-over');
      });

      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });

      el.addEventListener('drop', async (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        document.querySelectorAll('.diff-line.drag-over').forEach(d => d.classList.remove('drag-over'));
        if (!state._dragAnnotation) return;

        const lineNum = parseInt(el.dataset.line, 10);
        const side = el.dataset.side || 'new';
        if (isNaN(lineNum)) return;

        const drag = state._dragAnnotation;
        state._dragAnnotation = null;

        await api('/annotations/' + drag.id + '/move', {
          method: 'PATCH',
          body: { lineNumber: lineNum, side: side },
        });

        // Refresh the file view
        if (state.currentFileId) selectFile(state.currentFileId);
      });
    });
  }

  function bindServerAnnotations() {
    document.querySelectorAll('.annotation-item').forEach(item => {
      const id = item.dataset.annotationId;
      if (!id) return;
      const isStale = item.dataset.isStale === 'true';
      const category = item.querySelector('.annotation-category')?.textContent || '';
      const content = item.querySelector('.annotation-text')?.textContent || '';
      const annotation = { id: id, category: category, content: content, is_stale: isStale };
      var row = item.closest('.annotation-row');
      var lineEl = row ? row.previousElementSibling : null;
      bindAnnotationItemEvents(item, annotation, lineEl, row);
    });
  }

  // --- Diff Mode ---
  function bindDiffModeToggle() {
    document.querySelectorAll('[data-diff-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.diffMode = btn.dataset.diffMode;
        document.querySelectorAll('[data-diff-mode]').forEach(b => b.classList.toggle('active', b === btn));
        if (state.currentFileId) selectFile(state.currentFileId);
      });
    });
  }

  // --- File Filter ---
  function bindFileFilter() {
    var input = document.getElementById('file-filter');
    if (!input) return;
    var timer = null;
    input.addEventListener('input', function() {
      clearTimeout(timer);
      timer = setTimeout(function() {
        state.filterText = input.value;
        renderFileList();
      }, 150);
    });
    // Also handle Escape to clear
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        input.value = '';
        state.filterText = '';
        renderFileList();
        input.blur();
      }
    });
  }

  // --- Sidebar Resize ---
  function bindSidebarResize() {
    var handle = document.getElementById('sidebar-resize');
    var sidebar = document.querySelector('.sidebar');
    if (!handle || !sidebar) return;

    var dragging = false;
    var startX, startWidth;

    handle.addEventListener('mousedown', function(e) {
      dragging = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var newWidth = startWidth + (e.clientX - startX);
      newWidth = Math.max(200, Math.min(newWidth, window.innerWidth * 0.6));
      sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  // --- Wrap Toggle ---
  function bindWrapToggle() {
    const btn = document.getElementById('wrap-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      state.wrapLines = !state.wrapLines;
      btn.classList.toggle('active', state.wrapLines);
      const container = document.getElementById('diff-container');
      if (container) {
        container.classList.toggle('wrap-lines', state.wrapLines);
      }
      // Reset scroll positions when toggling
      if (!state.wrapLines) {
        resetScrollSync();
      }
    });
  }

  // --- Scroll Sync (split mode, no-wrap) ---
  function initScrollSync() {
    const container = document.getElementById('diff-container');
    if (!container) return;

    let lastScrollLeft = 0;
    let rafId = null;
    let syncing = false;

    container.addEventListener('scroll', function(e) {
      if (syncing || state.wrapLines || state.diffMode !== 'split') return;
      const target = e.target;
      if (!target.classList || !target.classList.contains('code')) return;
      if (!target.closest('.split-row')) return;

      const scrollLeft = target.scrollLeft;
      if (scrollLeft === lastScrollLeft) return;
      lastScrollLeft = scrollLeft;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(function() {
        syncing = true;
        container.querySelectorAll('.split-row .code').forEach(function(el) {
          if (el !== target && el.scrollLeft !== scrollLeft) {
            el.scrollLeft = scrollLeft;
          }
        });
        syncing = false;
      });
    }, true);
  }

  function resetScrollSync() {
    const container = document.getElementById('diff-container');
    if (!container) return;
    container.querySelectorAll('.split-row .code').forEach(function(el) {
      el.scrollLeft = 0;
    });
  }

  // --- Complete ---
  function bindCompleteButton() {
    const btn = document.getElementById('complete-review');
    if (!btn) return;
    btn.addEventListener('click', () => {
      showCompleteModal();
    });
  }

  function showCompleteModal() {
    var totalStale = 0;
    Object.keys(state.staleCounts).forEach(function(k) { totalStale += (state.staleCounts[k] || 0); });

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    if (totalStale > 0) {
      overlay.innerHTML =
        '<div class="modal">' +
          '<h3>Stale Annotations</h3>' +
          '<p>There ' + (totalStale === 1 ? 'is 1 stale annotation' : 'are ' + totalStale + ' stale annotations') +
          ' that could not be matched to the current diff. What would you like to do?</p>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-sm modal-cancel">Cancel</button>' +
            '<button class="btn btn-sm btn-danger" data-stale-action="discard">Discard All Stale</button>' +
            '<button class="btn btn-sm btn-primary" data-stale-action="keep">Keep All &amp; Complete</button>' +
          '</div>' +
        '</div>';

      overlay.querySelector('.modal-cancel').addEventListener('click', () => overlay.remove());
      overlay.querySelector('[data-stale-action="discard"]').addEventListener('click', async () => {
        await api('/annotations/stale/delete-all', { method: 'POST' });
        state.staleCounts = {};
        renderFileList();
        overlay.remove();
        showCompleteModal();
      });
      overlay.querySelector('[data-stale-action="keep"]').addEventListener('click', async () => {
        await api('/annotations/stale/keep-all', { method: 'POST' });
        state.staleCounts = {};
        renderFileList();
        overlay.remove();
        showCompleteModal();
      });

      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
      return;
    }

    overlay.innerHTML =
      '<div class="modal">' +
        '<h3>Complete Review</h3>' +
        '<p>This will generate a review summary that AI tools can read and act on. Annotations will be exported to .glassbox/ in the repository.</p>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-sm modal-cancel">Cancel</button>' +
          '<button class="btn btn-sm btn-primary modal-confirm">Complete</button>' +
        '</div>' +
      '</div>';

    overlay.querySelector('.modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.modal-confirm').addEventListener('click', async () => {
      const result = await api('/review/complete', { method: 'POST' });
      var aiCommand = result.isCurrent
        ? 'Read .glassbox/latest-review.md and apply the feedback.'
        : 'Read .glassbox/review-' + result.reviewId + '.md and apply the feedback.';

      var gitignoreHtml = '';
      if (result.gitignorePrompt) {
        gitignoreHtml =
          '<div class="modal-gitignore">' +
            '<p class="modal-label">.glassbox/ is not in your .gitignore</p>' +
            '<div class="modal-actions" style="justify-content:flex-start;margin-top:4px">' +
              '<button class="btn btn-sm btn-primary" id="gitignore-add">Add to .gitignore</button>' +
              '<button class="btn btn-sm" id="gitignore-dismiss">Don\\'t ask for 30 days</button>' +
            '</div>' +
          '</div>';
      }

      overlay.querySelector('.modal').innerHTML =
        '<h3>Review Completed</h3>' +
        '<p class="modal-label">Review exported to:</p>' +
        '<div class="modal-copyable" data-copy="' + esc(result.exportPath) + '" title="Click to copy">' + esc(result.exportPath) + '</div>' +
        '<p class="modal-label">Tell your AI tool:</p>' +
        '<div class="modal-copyable" data-copy="' + esc(aiCommand) + '" title="Click to copy">' + esc(aiCommand) + '</div>' +
        gitignoreHtml +
        '<div class="modal-actions"><button class="btn btn-sm btn-primary" onclick="this.closest(\\'.modal-overlay\\').remove()">Done</button></div>';

      // Bind copy-to-clipboard
      overlay.querySelectorAll('.modal-copyable').forEach(function(el) {
        el.addEventListener('click', function() {
          navigator.clipboard.writeText(el.dataset.copy);
          el.classList.add('copied');
          setTimeout(function() { el.classList.remove('copied'); }, 1500);
        });
      });

      // Bind gitignore buttons
      var addBtn = overlay.querySelector('#gitignore-add');
      if (addBtn) {
        addBtn.addEventListener('click', async function() {
          await api('/gitignore/add', { method: 'POST' });
          var container = addBtn.closest('.modal-gitignore');
          container.innerHTML = '<p class="modal-label" style="color:var(--green)">Added .glassbox/ to .gitignore</p>';
        });
      }
      var dismissBtn = overlay.querySelector('#gitignore-dismiss');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', async function() {
          await api('/gitignore/dismiss', { method: 'POST' });
          dismissBtn.closest('.modal-gitignore').remove();
        });
      }

      // Swap complete button to reopen
      const completeBtn = document.getElementById('complete-review');
      if (completeBtn) {
        const reopenBtn = document.createElement('button');
        reopenBtn.className = 'btn btn-primary';
        reopenBtn.id = 'reopen-review';
        reopenBtn.textContent = 'Reopen Review';
        completeBtn.replaceWith(reopenBtn);
        bindReopenButton();
      }
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function bindReopenButton() {
    const btn = document.getElementById('reopen-review');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      await api('/review/reopen', { method: 'POST' });
      // Swap reopen button to complete
      const completeBtn = document.createElement('button');
      completeBtn.className = 'btn btn-primary btn-complete';
      completeBtn.id = 'complete-review';
      completeBtn.textContent = 'Complete Review';
      btn.replaceWith(completeBtn);
      bindCompleteButton();
    });
  }

  // --- Progress ---
  function updateProgress() {
    const total = state.files.length;
    const reviewed = state.files.filter(f => f.status === 'reviewed').length;
    const summary = document.getElementById('progress-summary');
    if (summary) summary.textContent = reviewed + ' of ' + total + ' files reviewed';

    // Update progress bar
    let bar = document.querySelector('.progress-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.innerHTML = '<div class="progress-bar-fill"></div>';
      const controls = document.querySelector('.sidebar-controls');
      if (controls) controls.appendChild(bar);
    }
    const fill = bar.querySelector('.progress-bar-fill');
    if (fill) fill.style.width = (total ? (reviewed / total * 100) : 0) + '%';
  }

  // --- Sidebar Events ---
  function bindSidebarEvents() {
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        navigateFile(1);
        e.preventDefault();
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        navigateFile(-1);
        e.preventDefault();
      }
    });
  }

  function navigateFile(delta) {
    var order = state.fileOrder;
    var idx = order.indexOf(state.currentFileId);
    var next = idx + delta;
    if (next >= 0 && next < order.length) {
      selectFile(order[next]);
    }
  }

  // Run
  init();
})();
`;
}
