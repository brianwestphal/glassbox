import { api } from '../api.js';
import { toElement } from '../dom.js';
import { diffViewStore, reviewStore } from '../stores/index.js';
import { applyHighlighting,getLanguageList } from './highlight.js';
import { selectFile, updateToolbarLanguage  } from './selection.js';
import { syncSplitColumnHeights } from './splitSync.js';

// Languages most developers encounter regularly, shown first in the picker
const POPULAR_LANGS = new Set([
  'bash', 'c', 'cpp', 'csharp', 'css', 'dart', 'diff', 'dockerfile',
  'elixir', 'erlang', 'go', 'graphql', 'groovy', 'haskell', 'java',
  'javascript', 'json', 'kotlin', 'less', 'lua', 'makefile', 'markdown',
  'objectivec', 'perl', 'php', 'plaintext', 'powershell', 'python',
  'r', 'ruby', 'rust', 'scala', 'scss', 'shell', 'sql', 'swift',
  'typescript', 'xml', 'yaml', 'zig',
]);

export function bindToolbar() {
  bindDiffModeSegments();
  bindWrapToggle();
  bindWhitespaceToggle();
  bindLanguageSelector();
  bindSvgModeToggle();
}

function bindSvgModeToggle() {
  document.querySelectorAll('[data-svg-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.svgMode as 'code' | 'rendered';
      diffViewStore.actions.update({ svgViewMode: mode });
      void api('/ai/preferences', { method: 'POST', body: { svg_view_mode: mode } });
      document.querySelectorAll('[data-svg-mode]').forEach(b => b.classList.toggle('active', b === btn));
      const currentFileId = reviewStore.state.value.currentFileId;
      if (currentFileId !== null) {
        void selectFile(currentFileId);
      }
    });
  });
}

function bindDiffModeSegments() {
  document.querySelectorAll('[data-diff-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.diffMode as 'split' | 'unified';
      diffViewStore.actions.update({ diffMode: mode });
      document.querySelectorAll('[data-diff-mode]').forEach(b => { b.classList.toggle('active', b === btn); });
      const currentFileId = reviewStore.state.value.currentFileId;
      if (currentFileId !== null) {
        void selectFile(currentFileId);
      }
    });
  });
}

function bindWrapToggle() {
  const btn = document.getElementById('wrap-toggle');
  if (btn === null) return;
  btn.addEventListener('click', () => {
    const wrapLines = !diffViewStore.state.value.wrapLines;
    diffViewStore.actions.update({ wrapLines });
    btn.classList.toggle('active', wrapLines);
    const container = document.getElementById('diff-container');
    if (container !== null) container.classList.toggle('wrap-lines', wrapLines);
    syncSplitColumnHeights();
    if (!wrapLines) {
      document.getElementById('diff-container')?.querySelectorAll('.split-row .code, .split-columns .code').forEach(el => {
        (el as HTMLElement).scrollLeft = 0;
      });
    }
  });
}

function bindWhitespaceToggle() {
  const btn = document.getElementById('whitespace-toggle');
  if (btn === null) return;
  btn.classList.toggle('active', diffViewStore.state.value.ignoreWhitespace);
  btn.addEventListener('click', () => {
    const ignoreWhitespace = !diffViewStore.state.value.ignoreWhitespace;
    diffViewStore.actions.update({ ignoreWhitespace });
    btn.classList.toggle('active', ignoreWhitespace);
    void api('/ai/preferences', { method: 'POST', body: { ignore_whitespace: ignoreWhitespace } });
    const currentFileId = reviewStore.state.value.currentFileId;
    if (currentFileId !== null) {
      void selectFile(currentFileId);
    }
  });
}

function bindLanguageSelector() {
  const btn = document.getElementById('language-btn');
  if (btn === null) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    showLanguagePicker(btn);
  });
}

function showLanguagePicker(btn: HTMLElement) {
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

  // Position above the button, clamped to viewport
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
      // No filter: show Auto, then popular, then separator, then rest
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

      popular.forEach(lang => {
        listEl.appendChild(langOption(lang));
      });

      if (rest.length > 0) {
        listEl.appendChild(toElement(<div className="language-separator"></div>));
        rest.forEach(lang => {
          listEl.appendChild(langOption(lang));
        });
      }
    } else {
      // Filtered: search all languages
      const filtered = allLangs.filter(l => l.toLowerCase().includes(q));
      if (filtered.length === 0) {
        listEl.appendChild(toElement(<div className="language-option disabled">No matches</div>));
        return;
      }
      filtered.forEach(lang => {
        listEl.appendChild(langOption(lang));
      });
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

  filterInput.addEventListener('input', () => { renderList(filterInput.value); });

  listEl.addEventListener('click', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('.language-option:not(.disabled)');
    if (opt === null) return;
    const lang = opt.dataset.lang ?? '';
    if (lang === '__auto__') {
      selectLang('', true);
    } else {
      selectLang(lang, false);
    }
  });

  document.body.appendChild(popup);

  // Clamp horizontal position so popup doesn't overflow the right edge
  const popupWidth = popup.offsetWidth;
  let left = rect.right - popupWidth; // right-align to button
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
