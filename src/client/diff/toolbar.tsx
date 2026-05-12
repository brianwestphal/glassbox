import { delegate, effect } from 'kerfjs';

import { api } from '../api.js';
import { toElement } from '../dom.js';
import { diffViewStore } from '../stores/index.js';
import { applyHighlighting, getLanguageList } from './highlight.js';
import { updateToolbarLanguage } from './index.js';

// Languages most developers encounter regularly, shown first in the picker
const POPULAR_LANGS = new Set([
  'bash', 'c', 'cpp', 'csharp', 'css', 'dart', 'diff', 'dockerfile',
  'elixir', 'erlang', 'go', 'graphql', 'groovy', 'haskell', 'java',
  'javascript', 'json', 'kotlin', 'less', 'lua', 'makefile', 'markdown',
  'objectivec', 'perl', 'php', 'plaintext', 'powershell', 'python',
  'r', 'ruby', 'rust', 'scala', 'scss', 'shell', 'sql', 'swift',
  'typescript', 'xml', 'yaml', 'zig',
]);

export function bindToolbar(): void {
  const toolbar = document.getElementById('diff-toolbar');
  if (toolbar === null) return;

  // Reflect current store state onto the persistent buttons (wrap, whitespace).
  // The store is the source of truth; class toggles are imperative because
  // these buttons are server-rendered and outside any mount() tree.
  reflectToolbarState();

  delegate(toolbar, 'click', '[data-svg-mode]', (_e, btn) => {
    const mode = (btn as HTMLElement).dataset.svgMode as 'code' | 'rendered';
    diffViewStore.actions.update({ svgViewMode: mode });
    void api('/ai/preferences', { method: 'POST', body: { svg_view_mode: mode } });
    toolbar.querySelectorAll('[data-svg-mode]').forEach(b => b.classList.toggle('active', b === btn));
  });

  delegate(toolbar, 'click', '[data-diff-mode]', (_e, btn) => {
    const mode = (btn as HTMLElement).dataset.diffMode as 'split' | 'unified';
    diffViewStore.actions.update({ diffMode: mode });
    toolbar.querySelectorAll('[data-diff-mode]').forEach(b => b.classList.toggle('active', b === btn));
  });

  delegate(toolbar, 'click', '#wrap-toggle', (_e, btn) => {
    const wrapLines = !diffViewStore.state.value.wrapLines;
    diffViewStore.actions.update({ wrapLines });
    (btn as HTMLElement).classList.toggle('active', wrapLines);
    if (!wrapLines) {
      document.getElementById('diff-container')?.querySelectorAll('.split-row .code, .split-columns .code').forEach(el => {
        (el as HTMLElement).scrollLeft = 0;
      });
    }
  });

  delegate(toolbar, 'click', '#whitespace-toggle', (_e, btn) => {
    const ignoreWhitespace = !diffViewStore.state.value.ignoreWhitespace;
    diffViewStore.actions.update({ ignoreWhitespace });
    (btn as HTMLElement).classList.toggle('active', ignoreWhitespace);
    void api('/ai/preferences', { method: 'POST', body: { ignore_whitespace: ignoreWhitespace } });
  });

  delegate(toolbar, 'click', '[data-image-mode]', (_e, btn) => {
    const mode = (btn as HTMLElement).dataset.imageMode ?? '';
    diffViewStore.actions.update({ lastImageMode: mode });
    void api('/ai/preferences', { method: 'POST', body: { last_image_mode: mode } });
  });

  delegate(toolbar, 'click', '#language-btn', (e, btn) => {
    e.stopPropagation();
    showLanguagePicker(btn as HTMLElement);
  });
}

function reflectToolbarState(): void {
  // Mirror store state onto the persistent toolbar buttons. The buttons are
  // server-rendered (outside any mount() tree), so we update their classes
  // imperatively from a kerfjs effect.
  effect(() => {
    const dv = diffViewStore.state.value;
    const wrap = document.getElementById('wrap-toggle');
    if (wrap !== null) wrap.classList.toggle('active', dv.wrapLines);
    const ws = document.getElementById('whitespace-toggle');
    if (ws !== null) ws.classList.toggle('active', dv.ignoreWhitespace);
    document.querySelectorAll('[data-diff-mode]').forEach(b =>
      b.classList.toggle('active', (b as HTMLElement).dataset.diffMode === dv.diffMode));
  });
}

function showLanguagePicker(btn: HTMLElement): void {
  document.querySelectorAll('.language-popup').forEach(el => { el.remove(); });

  const allLangs = getLanguageList();
  const popular = allLangs.filter(l => POPULAR_LANGS.has(l)).sort();
  const rest = allLangs.filter(l => !POPULAR_LANGS.has(l)).sort();
  const rect = btn.getBoundingClientRect();

  const popup = toElement(
    <div className="language-popup">
      <input type="text" className="language-filter" placeholder="Filter languages..." />
      <div className="language-list"></div>
    </div>
  );

  popup.style.position = 'fixed';
  popup.style.bottom = String(window.innerHeight - rect.top + 4) + 'px';

  const listQuery = popup.querySelector('.language-list');
  if (listQuery === null) return;
  const listEl = listQuery as HTMLElement;
  const filterInput = popup.querySelector('.language-filter') as HTMLInputElement;

  function selectLang(lang: string, auto: boolean) {
    diffViewStore.actions.update({
      highlightAuto: auto,
      highlightLang: auto ? diffViewStore.state.value.detectedLang : lang,
    });
    applyHighlighting();
    updateToolbarLanguage();
    popup.remove();
  }

  function renderList(filter: string) {
    const q = filter.toLowerCase();
    listEl.innerHTML = '';

    if (q === '') {
      const dv = diffViewStore.state.value;
      const autoLabel = dv.detectedLang === 'plaintext' ? 'Plain Text' : dv.detectedLang;
      const autoItem = toElement(
        <div className={`language-option${dv.highlightAuto ? ' active' : ''}`} data-lang="__auto__">
          {'Auto (' + autoLabel + ')'}
        </div>
      );
      listEl.appendChild(autoItem);

      const sep = toElement(<div className="language-separator"></div>);
      listEl.appendChild(sep);

      popular.forEach(lang => { listEl.appendChild(langOption(lang)); });

      if (rest.length > 0) {
        listEl.appendChild(toElement(<div className="language-separator"></div>));
        rest.forEach(lang => { listEl.appendChild(langOption(lang)); });
      }
    } else {
      const filtered = allLangs.filter(l => l.toLowerCase().includes(q));
      if (filtered.length === 0) {
        listEl.appendChild(toElement(<div className="language-option disabled">No matches</div>));
        return;
      }
      filtered.forEach(lang => { listEl.appendChild(langOption(lang)); });
    }
  }

  function langOption(lang: string): HTMLElement {
    const dv = diffViewStore.state.value;
    const isActive = !dv.highlightAuto && lang === dv.highlightLang;
    return toElement(
      <div className={`language-option${isActive ? ' active' : ''}`} data-lang={lang}>
        {lang === 'plaintext' ? 'Plain Text' : lang}
      </div>
    );
  }

  renderList('');

  // The popup is a transient overlay (added to document.body, removed on
  // outside click) — it never lives inside a mount() tree, so direct
  // listeners on it are stable.
  filterInput.addEventListener('input', () => { renderList(filterInput.value); });

  delegate(listEl, 'click', '.language-option:not(.disabled)', (_e, opt) => {
    const lang = (opt as HTMLElement).dataset.lang ?? '';
    if (lang === '__auto__') selectLang('', true);
    else selectLang(lang, false);
  });

  document.body.appendChild(popup);

  const popupWidth = popup.offsetWidth;
  let left = rect.right - popupWidth;
  if (left < 4) left = 4;
  if (left + popupWidth > window.innerWidth - 4) left = window.innerWidth - popupWidth - 4;
  popup.style.left = String(left) + 'px';

  filterInput.focus();

  const closePopup = (e: Event) => {
    if (!popup.contains(e.target as Node)) {
      popup.remove();
      document.removeEventListener('click', closePopup, true);
    }
  };
  setTimeout(() => { document.addEventListener('click', closePopup, true); }, 0);
}
