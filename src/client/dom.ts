import type { SafeHtml } from 'kerfjs';
import { toElement as kerfToElement } from 'kerfjs';

export function toElement(html: SafeHtml | string): HTMLElement {
  return kerfToElement(html) as HTMLElement;
}

/**
 * Narrow a kerf `Element` (or any `EventTarget`) to a concrete HTML
 * subtype, with an actual `instanceof` runtime check. Use these inside
 * `delegate(root, 'click', selector, (_e, el) => asEl(el).dataset.foo)`
 * to replace the bare `(el as HTMLElement)` pattern — the selector
 * already guarantees the type at runtime, but routing through these
 * helpers means a typo or unexpected target throws a descriptive error
 * instead of silently doing the wrong thing on a `.dataset` access.
 *
 * Each helper throws on mismatch. The check is intentionally cheap —
 * `instanceof` against a global constructor — and only fires for events
 * actually dispatched on the page, so the overhead is negligible.
 */
export function asEl(node: unknown): HTMLElement {
  if (!(node instanceof HTMLElement)) {
    throw new Error(`asEl: expected HTMLElement, got ${describeNode(node)}`);
  }
  return node;
}

export function asInput(node: unknown): HTMLInputElement {
  if (!(node instanceof HTMLInputElement)) {
    throw new Error(`asInput: expected HTMLInputElement, got ${describeNode(node)}`);
  }
  return node;
}

export function asButton(node: unknown): HTMLButtonElement {
  if (!(node instanceof HTMLButtonElement)) {
    throw new Error(`asButton: expected HTMLButtonElement, got ${describeNode(node)}`);
  }
  return node;
}

export function asSelect(node: unknown): HTMLSelectElement {
  if (!(node instanceof HTMLSelectElement)) {
    throw new Error(`asSelect: expected HTMLSelectElement, got ${describeNode(node)}`);
  }
  return node;
}

export function asTextarea(node: unknown): HTMLTextAreaElement {
  if (!(node instanceof HTMLTextAreaElement)) {
    throw new Error(`asTextarea: expected HTMLTextAreaElement, got ${describeNode(node)}`);
  }
  return node;
}

/** Nullable variant of `asEl`. Returns `null` when the node isn't an
 *  `HTMLElement` (or is null/undefined) — use this for the `?.foo`
 *  property-access pattern where the upstream lookup may legitimately
 *  return nothing. */
export function asElOrNull(node: unknown): HTMLElement | null {
  return node instanceof HTMLElement ? node : null;
}

function describeNode(node: unknown): string {
  if (node === null) return 'null';
  if (node === undefined) return 'undefined';
  if (typeof node === 'object' && 'constructor' in node) {
    return node.constructor.name;
  }
  return typeof node;
}
