import { IconCopy, IconEdit, IconMoreHorizontal, IconTrash } from '../../icons.js';
import { raw } from '../../jsx-runtime.js';
import { api } from '../api.js';
import { toElement } from '../dom.js';
import { applyThemeColors, switchTheme } from '../themes.js';
import { showThemeEditor } from './themeEditor.js';

interface ThemeSummary {
  id: string;
  name: string;
  builtIn: boolean;
  colors: Record<string, string>;
}

interface ThemesResponse {
  themes: ThemeSummary[];
  activeId: string;
}

function showDeleteConfirm(themeName: string, onConfirm: () => void) {
  const confirmOverlay = toElement(<div className="modal-overlay"></div>);
  confirmOverlay.innerHTML = (
    <div className="modal" style="max-width:360px">
      <h3>Delete Theme</h3>
      <p>{'Delete "' + themeName + '"? This cannot be undone.'}</p>
      <div className="modal-actions">
        <button className="btn btn-sm" id="del-cancel">Cancel</button>
        <button className="btn btn-sm btn-danger" id="del-confirm">Delete</button>
      </div>
    </div>
  ).toString();

  confirmOverlay.querySelector('#del-cancel')?.addEventListener('click', () => confirmOverlay.remove());
  confirmOverlay.querySelector('#del-confirm')?.addEventListener('click', () => {
    confirmOverlay.remove();
    onConfirm();
  });
  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) confirmOverlay.remove();
  });

  document.body.appendChild(confirmOverlay);
}

export function showThemeManager(onThemeChanged?: () => void) {
  void (async () => {
    let data = await api<ThemesResponse>('/themes');
    const overlay = toElement(<div className="modal-overlay"></div>);

    function close() {
      document.removeEventListener('keydown', handleEscape);
      removeContextMenu();
      overlay.remove();
    }

    function handleEscape(e: KeyboardEvent) {
      if (contextMenuEl) {
        removeContextMenu();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') close();
    }

    // Context menu is rendered into document.body (not inside the modal) to avoid clipping
    let contextMenuEl: HTMLElement | null = null;

    function removeContextMenu() {
      if (contextMenuEl) {
        contextMenuEl.remove();
        contextMenuEl = null;
      }
    }

    async function refresh() {
      data = await api<ThemesResponse>('/themes');
      render();
    }

    async function useTheme(id: string) {
      await switchTheme(id);
      data.activeId = id;
      render();
      if (onThemeChanged) onThemeChanged();
    }

    function swatchHtml(colors: Record<string, string>): string {
      const keys = ['bg', 'text', 'accent', 'green', 'red'];
      return keys.map(k =>
        `<span class="theme-swatch" style="background:${colors[k] ?? '#888'}"></span>`
      ).join('');
    }

    function renderItem(t: ThemeSummary) {
      const isActive = t.id === data.activeId;
      return (
        <div className={`theme-manager-item${isActive ? ' active' : ''}`} data-theme-id={t.id}>
          <div className="theme-manager-info" data-click-use={t.id}>
            <div className="theme-manager-swatches" data-swatches={t.id}></div>
            <span className="theme-manager-name">{t.name}</span>
            {isActive && <span className="theme-manager-badge active">Active</span>}
          </div>
          <button className="btn btn-xs btn-icon tm-menu-btn" data-menu-id={t.id} title="Actions">
            {raw(IconMoreHorizontal().toString())}
          </button>
        </div>
      );
    }

    function render() {
      const builtIn = data.themes.filter(t => t.builtIn);
      const custom = data.themes.filter(t => !t.builtIn);

      const modalEl = overlay.querySelector('.modal');
      if (!modalEl) return;

      modalEl.innerHTML = (
        <>
          <div className="settings-header">
            <h3>Manage Themes</h3>
            <button className="settings-close" id="tm-close">&times;</button>
          </div>
          <div className="theme-manager-body">
            <div className="theme-manager-list">
              {builtIn.map(t => renderItem(t))}
              {custom.length > 0 && (
                <>
                  <div className="theme-manager-section-label">User Themes</div>
                  {custom.map(t => renderItem(t))}
                </>
              )}
            </div>
          </div>
        </>
      ).toString();

      // Inject swatches (raw HTML)
      for (const t of data.themes) {
        const el = modalEl.querySelector(`[data-swatches="${t.id}"]`);
        if (el) el.innerHTML = swatchHtml(t.colors);
      }

      bindEvents();
    }

    function showContextMenu(themeId: string, anchorEl: HTMLElement) {
      removeContextMenu();
      const theme = data.themes.find(t => t.id === themeId);
      if (!theme) return;

      // HS-431: "Edit" not "Edit Colors" since the editor also allows renaming
      const menu = toElement(
        <div className="tm-context-menu">
          <button className="tm-menu-item" data-ctx="edit">
            {raw(IconEdit().toString())}
            <span>Edit</span>
          </button>
          <button className="tm-menu-item" data-ctx="duplicate">
            {raw(IconCopy().toString())}
            <span>Duplicate</span>
          </button>
          {!theme.builtIn && (
            <button className="tm-menu-item tm-menu-danger" data-ctx="delete">
              {raw(IconTrash().toString())}
              <span>Delete</span>
            </button>
          )}
        </div>
      );

      // HS-432: Render into document.body, not inside the modal, to avoid clipping
      const rect = anchorEl.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.zIndex = '10000';

      // Position below the anchor, right-aligned
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.right = `${window.innerWidth - rect.right}px`;

      // Check if menu would go off-screen bottom, if so show above
      document.body.appendChild(menu);
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.bottom > window.innerHeight) {
        menu.style.top = `${rect.top - menuRect.height - 4}px`;
      }

      contextMenuEl = menu;

      // HS-430: Use stopPropagation on menu items so document click handler doesn't interfere
      menu.addEventListener('click', (e) => e.stopPropagation());

      menu.querySelector('[data-ctx="edit"]')?.addEventListener('click', () => {
        removeContextMenu();
        showThemeEditor(themeId, async () => {
          await refresh();
          if (onThemeChanged) onThemeChanged();
        });
      });

      menu.querySelector('[data-ctx="duplicate"]')?.addEventListener('click', async () => {
        removeContextMenu();
        await api('/themes', { method: 'POST', body: { sourceId: themeId } });
        await refresh();
        if (onThemeChanged) onThemeChanged();
      });

      menu.querySelector('[data-ctx="delete"]')?.addEventListener('click', () => {
        removeContextMenu();
        showDeleteConfirm(theme.name, async () => {
          const wasActive = themeId === data.activeId;
          await api(`/themes/${themeId}`, { method: 'DELETE' });
          if (wasActive) {
            const active = await api<{ id: string; colors: Record<string, string> }>('/themes/active');
            applyThemeColors(active.colors);
            document.documentElement.setAttribute('data-theme', active.id);
            data.activeId = active.id;
          }
          await refresh();
          if (onThemeChanged) onThemeChanged();
        });
      });

      // Close menu on next click anywhere else
      const closeOnClick = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) {
          removeContextMenu();
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnClick, { once: true }), 0);
    }

    function bindEvents() {
      overlay.querySelector('#tm-close')?.addEventListener('click', close);

      // Click theme name/info to switch
      overlay.querySelectorAll('[data-click-use]').forEach(el => {
        el.addEventListener('click', () => {
          const id = (el as HTMLElement).dataset.clickUse!;
          void useTheme(id);
        });
      });

      // Double-click theme item to open editor
      overlay.querySelectorAll('.theme-manager-item').forEach(el => {
        el.addEventListener('dblclick', () => {
          const id = (el as HTMLElement).dataset.themeId!;
          showThemeEditor(id, async () => {
            await refresh();
            if (onThemeChanged) onThemeChanged();
          });
        });
      });

      // "..." menu buttons
      overlay.querySelectorAll('.tm-menu-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = (btn as HTMLElement).dataset.menuId!;
          showContextMenu(id, btn as HTMLElement);
        });
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
    }

    document.addEventListener('keydown', handleEscape);
    overlay.innerHTML = (<div className="modal settings-dialog theme-manager-dialog"></div>).toString();
    document.body.appendChild(overlay);
    render();
  })();
}
