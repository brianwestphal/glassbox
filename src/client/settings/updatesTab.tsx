import { IconDownload } from '../../icons.js';
import type { SafeHtml } from '../../jsx-runtime.js';
import { getTauriInvoke, showUpdateBanner } from '../tauri.js';
import type { Tab, TabContext } from './tabContext.js';

function renderUpdatesTab(): SafeHtml {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <span className="settings-heading">Software Updates</span>
      </div>
      <p className="settings-disclaimer">Check for new versions of the Glassbox desktop app.</p>
      <button className="btn btn-sm" id="check-updates-btn">Check for Updates</button>
      <p className="settings-hint" id="check-updates-status"></p>
    </div>
  );
}

function bindUpdatesTab(overlay: HTMLElement): void {
  const btn = overlay.querySelector<HTMLButtonElement>('#check-updates-btn');
  const status = overlay.querySelector<HTMLElement>('#check-updates-status');
  if (btn === null || status === null) return;

  btn.addEventListener('click', () => { void (async () => {
    const invoke = getTauriInvoke();
    if (!invoke) return;
    btn.disabled = true;
    btn.textContent = 'Checking...';
    status.textContent = '';
    try {
      const version = (await invoke('check_for_update')) as string | null;
      if (version !== null && version !== '') {
        status.textContent = `Update available: v${version}`;
        showUpdateBanner(version);
      } else {
        status.textContent = 'Your software is up to date.';
      }
    } catch {
      status.textContent = 'Could not check for updates.';
    }
    btn.textContent = 'Check for Updates';
    btn.disabled = false;
  })(); });
}

export const updatesTab: Tab = {
  id: 'updates',
  label: 'Updates',
  icon: <IconDownload />,
  enabled: (ctx: TabContext) => ctx.isTauri,
  render: renderUpdatesTab,
  bind: bindUpdatesTab,
};
