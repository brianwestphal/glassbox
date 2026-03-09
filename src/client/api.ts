import { state } from './state.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = '/api' + path + separator + 'reviewId=' + encodeURIComponent(state.reviewId);
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return res.json() as Promise<T>;
}

export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// --- Client-side debug logging (sends to server console when --debug is active) ---

let debugEnabled: boolean | null = null; // null = not yet checked

/** Initialize debug state by checking the server. Call once at startup. */
export async function initDebug(): Promise<void> {
  try {
    const result = await api<{ enabled: boolean }>('/ai/debug-status');
    debugEnabled = result.enabled;
  } catch {
    debugEnabled = false;
  }
}

/** Fire-and-forget debug log to server console. No-op if debug is off. */
export function clientLog(message: string): void {
  if (debugEnabled !== true) return;
  void fetch('/api/ai/debug-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}
