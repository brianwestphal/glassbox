import type { SafeHtml } from 'kerfjs';
import { toElement as kerfToElement } from 'kerfjs';

export function toElement(html: SafeHtml | string): HTMLElement {
  return kerfToElement(html) as HTMLElement;
}
