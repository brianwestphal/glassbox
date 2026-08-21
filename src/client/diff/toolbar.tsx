import type { SafeHtml } from 'kerfjs';
import { delegate, effect, mount, signal } from 'kerfjs';

import { ImageModeSchema, saveAIPreferences } from '../../api/index.js';
import { asEl, asInput, toElement } from '../dom.js';
import { dismissOnOutsideClick, positionAnchoredPopup } from '../popup.js';
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

  void delegate(toolbar, 'click', '[data-svg-mode]', (_e, btn) => {
    const mode = asEl(btn).dataset.svgMode as 'code' | 'rendered';
    diffViewStore.actions.update({ svgViewMode: mode });
    void saveAIPreferences({ svg_view_mode: mode });
    toolbar.querySelectorAll('[data-svg-mode]').forEach(b => b.classList.toggle('active', b === btn));
  });

  void delegate(toolbar, 'click', '[data-diff-mode]', (_e, btn) => {
    const mode = asEl(btn).dataset.diffMode as 'split' | 'unified';
    diffViewStore.actions.update({ diffMode: mode });
    toolbar.querySelectorAll('[data-diff-mode]').forEach(b => b.classList.toggle('active', b === btn));
  });

  void delegate(toolbar, 'click', '#wrap-toggle', (_e, btn) => {
    const wrapLines = !diffViewStore.state.value.wrapLines;
    diffViewStore.actions.update({ wrapLines });
    asEl(btn).classList.toggle('active', wrapLines);
    if (!wrapLines) {
      document.getElementById('diff-container')?.querySelectorAll('.split-row .code, .split-columns .code').forEach(el => {
        asEl(el).scrollLeft = 0;
      });
    }
  });

  void delegate(toolbar, 'click', '#whitespace-toggle', (_e, btn) => {
    const ignoreWhitespace = !diffViewStore.state.value.ignoreWhitespace;
    diffViewStore.actions.update({ ignoreWhitespace });
    asEl(btn).classList.toggle('active', ignoreWhitespace);
    void saveAIPreferences({ ignore_whitespace: ignoreWhitespace });
  });

  void delegate(toolbar, 'click', '[data-image-mode]', (_e, btn) => {
    const mode = asEl(btn).dataset.imageMode ?? '';
    diffViewStore.actions.update({ lastImageMode: mode });
    const imageModeParsed = ImageModeSchema.safeParse(mode);
    if (imageModeParsed.success) {
      void saveAIPreferences({ last_image_mode: imageModeParsed.data });
    }
  });

  void delegate(toolbar, 'click', '#language-btn', (e, btn) => {
    e.stopPropagation();
    showLanguagePicker(asEl(btn));
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
      b.classList.toggle('active', asEl(b).dataset.diffMode === dv.diffMode));
  });
}

function showLanguagePicker(btn: HTMLElement): void {
  document.querySelectorAll('.language-popup').forEach(el => { el.remove(); });

  const allLangs = getLanguageList();
  const popular = allLangs.filter(l => POPULAR_LANGS.has(l)).sort();
  const rest = allLangs.filter(l => !POPULAR_LANGS.has(l)).sort();

  // Per-modal-session signal for the filter input — same precedent as the
  // theme manager / settings dialog openers. The render fn below reads it,
  // so any input event re-runs the list mount automatically.
  const filterSignal = signal('');

  const popup = toElement(
    <div className="language-popup">
      <input type="text" className="language-filter" placeholder="Filter languages..." />
      <div className="language-list"></div>
    </div>
  );

  const listEl = popup.querySelector<HTMLElement>('.language-list');
  const filterInput = popup.querySelector<HTMLInputElement>('.language-filter');
  if (listEl === null || filterInput === null) return;

  // Single tracked dismiss, assigned once the popup is wired up at the tail.
  // Picking a language closes the popup through it; previously this called a
  // bare `close()` that resolved to the global `window.close()` (a no-op in a
  // normal tab), so choosing a language never closed the picker.
  let dismissPopup: () => void = () => {};

  function selectLang(lang: string, auto: boolean) {
    diffViewStore.actions.update({
      highlightAuto: auto,
      highlightLang: auto ? diffViewStore.state.value.detectedLang : lang,
    });
    applyHighlighting();
    updateToolbarLanguage();
    dismissPopup();
  }

  function renderPickerList(filter: string): SafeHtml {
    const q = filter.toLowerCase();
    const dv = diffViewStore.state.value;
    if (q === '') {
      const autoLabel = dv.detectedLang === 'plaintext' ? 'Plain Text' : dv.detectedLang;
      return (
        <>
          <div
            className={`language-option${dv.highlightAuto ? ' active' : ''}`}
            data-lang="__auto__"
            data-key="__auto__"
          >
            {'Auto (' + autoLabel + ')'}
          </div>
          <div className="language-separator" data-key="__sep-popular__"></div>
          {popular.map(lang => langOption(lang, dv))}
          {rest.length > 0 ? <div className="language-separator" data-key="__sep-rest__"></div> : null}
          {rest.map(lang => langOption(lang, dv))}
        </>
      );
    }
    const filtered = allLangs.filter(l => l.toLowerCase().includes(q));
    if (filtered.length === 0) {
      return <div className="language-option disabled" data-key="__no-matches__">No matches</div>;
    }
    return <>{filtered.map(lang => langOption(lang, dv))}</>;
  }

  function langOption(lang: string, dv: typeof diffViewStore.state.value): SafeHtml {
    const isActive = !dv.highlightAuto && lang === dv.highlightLang;
    return (
      <div
        className={`language-option${isActive ? ' active' : ''}`}
        data-lang={lang}
        data-key={lang}
      >
        {lang === 'plaintext' ? 'Plain Text' : lang}
      </div>
    );
  }

  // The mount keeps the list reconciled against `filterSignal` (and any
  // `diffViewStore` reads inside the render fn, e.g. for highlighting the
  // currently active language). Re-runs are automatic.
  const disposeMount = mount(listEl, () => renderPickerList(filterSignal.value));

  // Filter input: route through the signal, not a direct addEventListener.
  void delegate(popup, 'input', '.language-filter', (e) => {
    filterSignal.value = asInput(e.target).value;
  });

  // Click selection: list options live inside the mount tree, so we delegate
  // from the popup root to survive every re-render.
  void delegate(popup, 'click', '.language-option:not(.disabled)', (_e, opt) => {
    const lang = asEl(opt).dataset.lang ?? '';
    if (lang === '__auto__') selectLang('', true);
    else selectLang(lang, false);
  });

  document.body.appendChild(popup);

  // Anchored above the button (right edges aligned), flipping below on
  // top-viewport overflow and clamped horizontally into view. Replaces the
  // bespoke bottom/left math; stays glued to the button on scroll / resize.
  const stopReposition = positionAnchoredPopup(popup, btn, { placement: 'top', align: 'end' });

  filterInput.focus();

  // Route every close path through this one dismiss so nothing leaks: it drops
  // the outside-click listener, the reposition scroll/resize listeners, and the
  // list mount. selectLang() calls it via `dismissPopup`.
  dismissPopup = dismissOnOutsideClick(popup, () => {
    stopReposition();
    disposeMount();
  });
}
