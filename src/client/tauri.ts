export function getTauriInvoke(): ((cmd: string) => Promise<unknown>) | null {
  const tauri = (window as unknown as Record<string, unknown>).__TAURI__ as
    | { core?: { invoke: (cmd: string) => Promise<unknown> } }
    | undefined;
  return tauri?.core?.invoke ?? null;
}

export function showUpdateBanner(version: string) {
  const banner = document.getElementById('update-banner');
  if (!banner) return;

  const label = document.getElementById('update-banner-label');
  if (label) label.textContent = `Update available: v${version}`;

  banner.style.display = 'flex';

  const installBtn = document.getElementById('update-install-btn') as HTMLButtonElement | null;
  installBtn?.addEventListener('click', () => {
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

  const dismissBtn = document.getElementById('update-banner-dismiss');
  dismissBtn?.addEventListener('click', () => {
    banner.style.display = 'none';
  });
}
