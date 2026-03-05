import type { SafeHtml } from '../jsx-runtime.js';

export function toElement(html: SafeHtml | string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html).trim();
  return tpl.content.firstElementChild as HTMLElement;
}
