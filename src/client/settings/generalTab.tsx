import type { SafeHtml } from '../../jsx-runtime.js';

interface ThemeSummary {
  id: string;
  name: string;
  builtIn: boolean;
}

interface GeneralTabData {
  themesData: { themes: ThemeSummary[]; activeId: string };
  activeThemeId: string;
  appName: string;
  isTauri: boolean;
}

interface GeneralTabCallbacks {
  switchTheme: (id: string) => void;
  showThemeManager: (onClose: () => void) => void;
  saveAppNameDebounced: () => void;
  refreshThemes: () => Promise<{ themes: ThemeSummary[]; activeId: string }>;
  setAppName: (name: string) => void;
  setActiveThemeId: (id: string) => void;
  renderContent: () => void;
}

export function renderGeneralTab(data: GeneralTabData): SafeHtml {
  const { themesData, activeThemeId, appName, isTauri } = data;
  return (
    <>
      <div className="settings-section">
        <label className="settings-label">Theme</label>
        <div className="settings-theme-row">
          <select className="settings-select" id="settings-theme">
            {themesData.themes.filter(t => t.builtIn).map(t =>
              <option value={t.id} selected={t.id === activeThemeId}>{t.name}</option>
            )}
            {themesData.themes.some(t => !t.builtIn) && (
              <>
                <option disabled>{'─'.repeat(20)}</option>
                {themesData.themes.filter(t => !t.builtIn).map(t =>
                  <option value={t.id} selected={t.id === activeThemeId}>{t.name}</option>
                )}
              </>
            )}
          </select>
          <button className="btn btn-sm" id="manage-themes-btn">Manage Themes</button>
        </div>
      </div>
      {isTauri && (
        <div className="settings-section">
          <label className="settings-label">App Name</label>
          <input type="text" className="settings-input" id="settings-app-name" value={appName} placeholder="Glassbox — project-name" />
          <p className="settings-hint">Custom window title for the desktop app. Leave blank for the default.</p>
        </div>
      )}
    </>
  );
}

export function bindGeneralTabEvents(overlay: HTMLElement, callbacks: GeneralTabCallbacks): void {
  // Theme selection — save immediately
  const themeSelect = overlay.querySelector<HTMLSelectElement>('#settings-theme');
  if (themeSelect !== null) {
    themeSelect.addEventListener('change', () => {
      callbacks.setActiveThemeId(themeSelect.value);
      callbacks.switchTheme(themeSelect.value);
    });
  }

  // Manage Themes button
  overlay.querySelector('#manage-themes-btn')?.addEventListener('click', () => {
    callbacks.showThemeManager(async () => {
      const updated = await callbacks.refreshThemes();
      callbacks.setActiveThemeId(updated.activeId);
      callbacks.renderContent();
    });
  });

  // App name input — debounced save
  const appNameInput = overlay.querySelector<HTMLInputElement>('#settings-app-name');
  if (appNameInput !== null) {
    appNameInput.addEventListener('input', () => {
      callbacks.setAppName(appNameInput.value);
      callbacks.saveAppNameDebounced();
    });
  }
}
