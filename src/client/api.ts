import { state } from './state.js';

export async function api(path: string, opts: { method?: string; body?: unknown } = {}) {
  const separator = path.includes('?') ? '&' : '?';
  const url = '/api' + path + separator + 'reviewId=' + encodeURIComponent(state.reviewId);
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
