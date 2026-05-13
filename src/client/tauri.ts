import { delegate } from 'kerfjs';

export function getTauriInvoke(): ((cmd: string) => Promise<unknown>) | null {
  const tauri = (window as unknown as Record<string, unknown>).__TAURI__ as
    | { core?: { invoke: (cmd: string) => Promise<unknown> } }
    | undefined;
  return tauri?.core?.invoke ?? null;
}

let bannerDelegatesBound = false;

export function showUpdateBanner(version: string): void {
  const banner = document.getElementById('update-banner');
  if (!banner) return;

  const label = document.getElementById('update-banner-label');
  if (label) label.textContent = `Update available: v${version}`;

  banner.style.display = 'flex';

  if (bannerDelegatesBound) return;
  bannerDelegatesBound = true;

  delegate(banner, 'click', '#update-install-btn', (_e, btn) => {
    const installBtn = btn as HTMLButtonElement;
    void (async () => {
      installBtn.textContent = 'Installing...';
      installBtn.disabled = true;
      try {
        const invoke = getTauriInvoke();
        await invoke?.('install_update');
        if (label) label.textContent = 'Update installed! Restart the app to apply.';
        installBtn.style.display = 'none';
      } catch {
        installBtn.textContent = 'Install Failed';
        installBtn.disabled = false;
      }
    })();
  });

  delegate(banner, 'click', '#update-banner-dismiss', () => {
    banner.style.display = 'none';
  });
}
