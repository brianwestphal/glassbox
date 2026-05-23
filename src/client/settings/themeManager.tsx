import type { SafeHtml } from 'kerfjs';
import { attr, delegate, mount, signal } from 'kerfjs';

import type { ListThemesResp, ThemeSummary as ApiThemeSummary } from '../../api/index.js';
import { createTheme, deleteTheme, getActiveTheme, listThemes } from '../../api/index.js';
import { IconCopy, IconEdit, IconMoreHorizontal, IconTrash } from '../../icons.js';
import { asEl, toElement } from '../dom.js';
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

function showDeleteConfirm(themeName: string, onConfirm: () => void): void {
  const confirmOverlay = toElement(
    <div className="modal-overlay">
      <div className="modal" style="max-width:360px">
        <h3>Delete Theme</h3>
        <p>{`Delete "${themeName}"? This cannot be undone.`}</p>
        <div className="modal-actions">
          <button className="btn btn-sm" id="del-cancel">Cancel</button>
          <button className="btn btn-sm btn-danger" id="del-confirm">Delete</button>
        </div>
      </div>
    </div>
  );

  confirmOverlay.querySelector('#del-cancel')?.addEventListener('click', () => { confirmOverlay.remove(); });
  confirmOverlay.querySelector('#del-confirm')?.addEventListener('click', () => {
    confirmOverlay.remove();
    onConfirm();
  });
  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) confirmOverlay.remove();
  });

  document.body.appendChild(confirmOverlay);
}

export function showThemeManager(onThemeChanged?: () => void): void {
  void (async () => {
    const initial = await listThemes();
    const themesSignal = signal<ThemesResponse>(initial);

    const overlay = toElement(<div className="modal-overlay"><div className="modal settings-dialog theme-manager-dialog"></div></div>);
    const modalEl = overlay.querySelector<HTMLElement>('.modal');
    if (modalEl === null) return;

    let contextMenuEl: HTMLElement | null = null;
    let disposeMount: (() => void) | null = null;

    function removeContextMenu(): void {
      if (contextMenuEl !== null) {
        contextMenuEl.remove();
        contextMenuEl = null;
      }
    }

    function close(): void {
      document.removeEventListener('keydown', handleEscape);
      removeContextMenu();
      if (disposeMount !== null) disposeMount();
      overlay.remove();
    }

    function handleEscape(e: KeyboardEvent): void {
      if (contextMenuEl !== null) {
        removeContextMenu();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') close();
    }

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

      // Render into document.body (not the modal) to avoid clipping.
      const rect = anchorEl.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.zIndex = '10000';
      menu.style.top = `${String(rect.bottom + 4)}px`;
      menu.style.right = `${String(window.innerWidth - rect.right)}px`;

      document.body.appendChild(menu);
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.bottom > window.innerHeight) {
        menu.style.top = `${String(rect.top - menuRect.height - 4)}px`;
      }
      contextMenuEl = menu;

      // Delegate clicks within the transient menu — and stop propagation so the
      // outside-click handler below doesn't immediately dismiss it.
      menu.addEventListener('click', (e) => { e.stopPropagation(); });
      void delegate(menu, 'click', CTX.edit.selector, () => {
        removeContextMenu();
        openEditor(themeId);
      });
      void delegate(menu, 'click', CTX.duplicate.selector, () => {
        void (async () => {
          removeContextMenu();
          await createTheme({ sourceId: themeId });
          await refresh();
          if (onThemeChanged !== undefined) onThemeChanged();
        })();
      });
      void delegate(menu, 'click', CTX.delete.selector, () => {
        removeContextMenu();
        showDeleteConfirm(theme.name, () => {
          void (async () => {
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
        });
      });

      // Outside-click dismiss for a transient document-body overlay: register a
      // one-shot document-level listener (popups that live outside any mount()
      // tree need a direct addEventListener, not a delegate()).
      const closeOnClick = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) removeContextMenu();
      };
      setTimeout(() => { document.addEventListener('click', closeOnClick, { once: true }); }, 0);
    }

    disposeMount = mount(modalEl, () => renderManager(themesSignal.value));

    // Delegated handlers
    void delegate(overlay, 'click', '#tm-close', close);
    void delegate(overlay, 'click', '[data-click-use]', (_e, el) => {
      const id = asEl(el).dataset.clickUse ?? '';
      if (id !== '') void useTheme(id);
    });
    void delegate(overlay, 'dblclick', '.theme-manager-item', (_e, el) => {
      const id = asEl(el).dataset.themeId ?? '';
      if (id !== '') openEditor(id);
    });
    void delegate(overlay, 'click', '.tm-menu-btn', (e, btn) => {
      e.stopPropagation();
      const id = asEl(btn).dataset.menuId ?? '';
      if (id !== '') showContextMenu(id, asEl(btn));
    });

    // Click outside the modal closes — direct listener on the overlay
    // (overlay isn't inside a mount() tree).
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    document.addEventListener('keydown', handleEscape);
    document.body.appendChild(overlay);
  })();
}

function renderItem(t: ThemeSummary, activeId: string): SafeHtml {
  const isActive = t.id === activeId;
  return (
    <div data-key={t.id} className={`theme-manager-item${isActive ? ' active' : ''}`} data-theme-id={t.id}>
      <div className="theme-manager-info" data-click-use={t.id}>
        <div className="theme-manager-swatches">
          {SWATCH_KEYS.map(k => (
            <span className="theme-swatch" style={`background:${(t.colors as unknown as Record<string, string>)[k] ?? '#888'}`}></span>
          ))}
        </div>
        <span className="theme-manager-name">{t.name}</span>
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
        <button className="settings-close" id="tm-close">&times;</button>
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
