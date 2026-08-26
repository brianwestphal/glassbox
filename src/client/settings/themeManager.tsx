import type { SafeHtml } from 'kerfjs';
import { attr, delegate, signal } from 'kerfjs';
import { delegateActions } from 'kerfjs/actions';
import { confirm, overlay } from 'kerfjs/overlay';

import type { ListThemesResp, ThemeSummary as ApiThemeSummary } from '../../api/index.js';
import { createTheme, deleteTheme, getActiveTheme, listThemes } from '../../api/index.js';
import { IconCopy, IconEdit, IconMoreHorizontal, IconTrash, IconX } from '../../icons.js';
import { themeColorsToRecord } from '../../themes/built-in.js';
import { asEl, toElement } from '../dom.js';
import { dismissOnOutsideClick, positionAnchoredPopup } from '../popup.js';
import { applyThemeColors, switchTheme } from '../themes.js';
import { showThemeEditor } from './themeEditor.js';

const CTX = {
  edit: attr('data-ctx', 'edit'),
  duplicate: attr('data-ctx', 'duplicate'),
  delete: attr('data-ctx', 'delete'),
} as const;

type ThemesResponse = ListThemesResp;
type ThemeSummary = ApiThemeSummary;

const SWATCH_KEYS = ['bg', 'text', 'accent', 'green', 'red'];

export function showThemeManager(onThemeChanged?: () => void): void {
  void (async () => {
    const initial = await listThemes();
    const themesSignal = signal<ThemesResponse>(initial);

    let contextMenuEl: HTMLElement | null = null;
    // Disposer for the open context menu's scroll/resize reposition listeners.
    // Every close path routes through removeContextMenu() so they can't leak.
    let stopContextMenuReposition: (() => void) | null = null;

    function removeContextMenu(): void {
      stopContextMenuReposition?.();
      stopContextMenuReposition = null;
      if (contextMenuEl !== null) {
        contextMenuEl.remove();
        contextMenuEl = null;
      }
    }

    // The whole modal — backdrop, content mount, focus trap, and focus restore —
    // is owned by kerfjs/overlay. We reuse Glassbox's `.modal-overlay` backdrop
    // class and wrap the reactive list in the app's `.modal` surface. Escape is
    // handled manually below so it can be two-level (close the context menu
    // first, then the manager), so overlay() is set to backdrop dismissal only.
    const handle = overlay(
      () => (
        <div className="modal settings-dialog theme-manager-dialog">
          {renderManager(themesSignal.value)}
        </div>
      ),
      { className: 'modal-overlay', dismiss: ['backdrop'], trap: true, native: true },
    );

    function close(): void { handle.close(); }

    // Escape handling — routed so a single Escape dismisses only the TOPMOST
    // surface (GB-1148). With `native: true` the manager is a native <dialog>,
    // and the UA fires the `cancel` event ONLY on the topmost modal dialog, so
    // this never fires while a child overlay (the theme editor, or a
    // delete-confirm) is stacked on top — Escape then closes that child alone.
    // We intercept `cancel` (rather than passing `dismiss: ['escape']`) so we
    // can do the two-level close: an open context menu is dismissed first, and a
    // second Escape closes the manager. `preventDefault()` stops the UA's own
    // close so the close routes through kerf (teardown + focus restore).
    // A document-level keydown was used before, but it fired regardless of which
    // dialog was topmost, so one Escape leaked into the surface underneath.
    const dialogEl = handle.el instanceof HTMLDialogElement ? handle.el : null;
    if (dialogEl !== null) {
      const onCancel = (e: Event): void => {
        e.preventDefault();
        if (contextMenuEl !== null) { removeContextMenu(); return; }
        handle.close();
      };
      dialogEl.addEventListener('cancel', onCancel);
      void handle.result.then(() => { dialogEl.removeEventListener('cancel', onCancel); });
    } else {
      // Div fallback (no <dialog>.showModal() support): there is no `cancel`
      // event and no top-layer topmost semantics, so fall back to a
      // document-level keydown (the pre-native behavior).
      const handleEscape = (e: KeyboardEvent): void => {
        if (contextMenuEl !== null) { removeContextMenu(); e.stopPropagation(); return; }
        if (e.key === 'Escape') handle.close();
      };
      document.addEventListener('keydown', handleEscape);
      void handle.result.then(() => { document.removeEventListener('keydown', handleEscape); });
    }

    // Drop any open context menu when the overlay closes by any path
    // (backdrop click or a programmatic close()).
    void handle.result.then(() => { removeContextMenu(); });

    async function refresh(): Promise<void> {
      themesSignal.value = await listThemes();
    }

    async function useTheme(id: string): Promise<void> {
      await switchTheme(id);
      themesSignal.value = { ...themesSignal.value, activeId: id };
      if (onThemeChanged !== undefined) onThemeChanged();
    }

    function openEditor(themeId: string): void {
      showThemeEditor(themeId, () => {
        void (async () => {
          await refresh();
          if (onThemeChanged !== undefined) onThemeChanged();
        })();
      });
    }

    function showContextMenu(themeId: string, anchorEl: HTMLElement): void {
      removeContextMenu();
      const data = themesSignal.value;
      const theme = data.themes.find(t => t.id === themeId);
      if (theme === undefined) return;

      const menu = toElement(
        <div className="tm-context-menu" data-theme-id={themeId}>
          <button className="tm-menu-item" {...CTX.edit.attrs}>
            <IconEdit />
            <span>Edit</span>
          </button>
          <button className="tm-menu-item" {...CTX.duplicate.attrs}>
            <IconCopy />
            <span>Duplicate</span>
          </button>
          {!theme.builtIn && (
            <button className="tm-menu-item tm-menu-danger" {...CTX.delete.attrs}>
              <IconTrash />
              <span>Delete</span>
            </button>
          )}
        </div>
      );

      // Append INTO the overlay element (`handle.el`), not `document.body`
      // (GB-1143): with `native: true` the manager is a native `<dialog>` opened
      // via `showModal()`, which inerts everything OUTSIDE it — a body-appended
      // menu would be non-interactive. Living inside the dialog keeps it in the
      // top layer + interactive. `position: fixed` still anchors it to the
      // trigger in viewport coords, and the dialog's `overflow: visible` (see
      // `_modal.scss`) means it isn't clipped. Works in the div-fallback too.
      handle.el.appendChild(menu);
      stopContextMenuReposition = positionAnchoredPopup(menu, anchorEl, { align: 'end' });
      contextMenuEl = menu;

      // Delegate clicks within the transient menu — and stop propagation so the
      // outside-click handler below doesn't immediately dismiss it.
      menu.addEventListener('click', (e) => { e.stopPropagation(); });
      // One delegated listener for the whole context-menu action table
      // (kerfjs/actions `delegateActions`) — replaces three separate delegate()
      // calls that each keyed on the same `data-ctx` attribute. The CTX specs
      // above are the single source of truth for both the JSX attribute and the
      // dispatch key (`.value`).
      void delegateActions(menu, 'click', {
        [CTX.edit.value]: () => {
          removeContextMenu();
          openEditor(themeId);
        },
        [CTX.duplicate.value]: () => {
          void (async () => {
            removeContextMenu();
            await createTheme({ sourceId: themeId });
            await refresh();
            if (onThemeChanged !== undefined) onThemeChanged();
          })();
        },
        [CTX.delete.value]: () => {
          removeContextMenu();
          void (async () => {
            // Promise-based confirm from kerfjs/overlay (focus-trapped, Escape /
            // backdrop dismiss, restore-focus) — replaces the hand-rolled
            // overlay + three addEventListener() dismiss handlers.
            const ok = await confirm(`Delete "${theme.name}"? This cannot be undone.`, {
              title: 'Delete Theme', okText: 'Delete', cancelText: 'Cancel', danger: true, native: true,
            });
            if (!ok) return;
            const wasActive = themeId === themesSignal.value.activeId;
            await deleteTheme({ id: themeId });
            if (wasActive) {
              const active = await getActiveTheme();
              applyThemeColors(active.colors);
              document.documentElement.setAttribute('data-theme', active.id);
            }
            await refresh();
            if (onThemeChanged !== undefined) onThemeChanged();
          })();
        },
      }, { attr: 'data-ctx' });

      dismissOnOutsideClick(menu, removeContextMenu);
    }

    // Delegated handlers on the overlay wrapper (`handle.el`). It is the mount
    // root and persists across list re-renders, so delegation on it is stable.
    void delegate(handle.el, 'click', '#tm-close', close);
    void delegate(handle.el, 'click', '[data-click-use]', (_e, el) => {
      const id = asEl(el).dataset.clickUse ?? '';
      if (id !== '') void useTheme(id);
    });
    void delegate(handle.el, 'dblclick', '.theme-manager-item', (_e, el) => {
      const id = asEl(el).dataset.themeId ?? '';
      if (id !== '') openEditor(id);
    });
    void delegate(handle.el, 'click', '.tm-menu-btn', (e, btn) => {
      e.stopPropagation();
      const id = asEl(btn).dataset.menuId ?? '';
      if (id !== '') showContextMenu(id, asEl(btn));
    });
  })();
}

function renderItem(t: ThemeSummary, activeId: string): SafeHtml {
  const isActive = t.id === activeId;
  return (
    <div data-key={t.id} className={`theme-manager-item${isActive ? ' active' : ''}`} data-theme-id={t.id}>
      <div className="theme-manager-info" data-click-use={t.id}>
        <div className="theme-manager-swatches">
          {SWATCH_KEYS.map(k => (
            <span className="theme-swatch" style={`background:${themeColorsToRecord(t.colors)[k] ?? '#888'}`}></span>
          ))}
        </div>
        <span className="theme-manager-name">{t.name}</span>
        {/* Marks themes that clear WCAG AA contrast everywhere (GB-1185). */}
        {t.wcagAA && <span className="theme-manager-badge aa" title="Meets WCAG AA contrast on all text">AA</span>}
        {isActive && <span className="theme-manager-badge active">Active</span>}
      </div>
      <button className="btn btn-xs btn-icon tm-menu-btn" data-menu-id={t.id} title="Actions">
        <IconMoreHorizontal />
      </button>
    </div>
  );
}

function renderManager(data: ThemesResponse): SafeHtml {
  const builtIn = data.themes.filter(t => t.builtIn);
  const custom = data.themes.filter(t => !t.builtIn);
  return (
    <>
      <div className="settings-header">
        <h3>Manage Themes</h3>
        <button className="settings-close" id="tm-close" title="Close" aria-label="Close"><IconX /></button>
      </div>
      <div className="theme-manager-body">
        <div className="theme-manager-list">
          {builtIn.map(t => renderItem(t, data.activeId))}
          {custom.length > 0 && (
            <>
              <div className="theme-manager-section-label">User Themes</div>
              {custom.map(t => renderItem(t, data.activeId))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
