import { delegate } from 'kerfjs';

import { asButton } from './dom.js';

interface TauriGlobal {
  core?: { invoke: (cmd: string) => Promise<unknown> };
  event?: { listen: (name: string, cb: () => void) => void };
}

/** Read the `window.__TAURI__` global (defined when running inside the
 *  Tauri shell, undefined in a plain browser). Centralized here so every
 *  caller doesn't repeat the cast-through-unknown pattern. */
export function getTauriGlobal(): TauriGlobal | undefined {
  return (window as unknown as Record<string, unknown>).__TAURI__ as TauriGlobal | undefined;
}

/** Convenience: returns the Tauri `invoke()` if available, otherwise `null`. */
export function getTauriInvoke(): ((cmd: string) => Promise<unknown>) | null {
  return getTauriGlobal()?.core?.invoke ?? null;
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

  void delegate(banner, 'click', '#update-install-btn', (_e, btn) => {
    const installBtn = asButton(btn);
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

  void delegate(banner, 'click', '#update-banner-dismiss', () => {
    banner.style.display = 'none';
  });
}
