/**
 * Plugin UI extensions (doc 30): render a plugin's registered UI elements into
 * the predefined host locations (`header`, `diff-toolbar`, `sidebar-footer`) and
 * round-trip clicks to the plugin's `onAction` via `POST /api/plugins/:id/action`.
 *
 * Elements are declarative (icon + label + action id — the plugin ships no DOM);
 * the host builds every node and owns the click wiring. Only `button` and `link`
 * render today; stateful controls (toggle / switch / segmented-control) are
 * declared in the contract but not yet rendered (a follow-up).
 */
import { delegate, raw } from 'kerfjs';

import type { PluginUIElementInfo } from '../../api/index.js';
import { listPluginUi, runPluginAction } from '../../api/index.js';
import { asEl, toElement } from '../dom.js';
import { showToast } from '../toast.js';

/** Location id → the server-rendered slot's DOM id (reviewShell.tsx). */
const SLOTS: Record<string, string> = {
  header: 'plugin-ui-header',
  'diff-toolbar': 'plugin-ui-diff-toolbar',
  'sidebar-footer': 'plugin-ui-sidebar-footer',
};

let cached: PluginUIElementInfo[] = [];
let wired = false;

/** Build a button or link element; null for a type the host doesn't render yet. */
function renderElement(el: PluginUIElementInfo): HTMLElement | null {
  const icon = el.icon !== undefined && el.icon !== '' ? el.icon : null;
  if (el.type === 'button') {
    const cls = `plugin-ui-btn${el.style === 'primary' ? ' primary' : ''}${el.style === 'danger' ? ' danger' : ''}`;
    return toElement(
      <button
        type="button"
        className={cls}
        title={el.title ?? el.label ?? ''}
        data-plugin-ui-id={el.pluginId}
        data-plugin-ui-action={el.action ?? ''}
      >
        {/* eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- plugin-supplied inert SVG icon; installed plugins are trusted (doc 29 §29.6). */}
        {icon !== null ? raw(icon) : null}
        {el.label !== undefined && el.label !== '' ? <span className="plugin-ui-label">{el.label}</span> : null}
      </button>,
    );
  }
  if (el.type === 'link' && el.url !== undefined && el.url !== '') {
    return toElement(
      <a className="plugin-ui-link" href={el.url} target="_blank" rel="noopener noreferrer" title={el.title ?? ''}>
        {/* eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- plugin-supplied inert SVG icon; installed plugins are trusted (doc 29 §29.6). */}
        {icon !== null ? raw(icon) : null}
        {el.label ?? el.url}
      </a>,
    );
  }
  // toggle / switch / segmented-control: declared in the contract, not yet rendered.
  return null;
}

/** Repaint every slot from the cached element list. */
function paint(): void {
  for (const [location, slotId] of Object.entries(SLOTS)) {
    const slot = document.getElementById(slotId);
    if (slot === null) continue;
    slot.replaceChildren();
    const els = cached.filter((e) => e.location === location);
    slot.classList.toggle('has-plugin-ui', els.length > 0);
    for (const el of els) {
      const node = renderElement(el);
      if (node !== null) slot.appendChild(node);
    }
  }
}

/** Run a UI-element action; surface an error / `message` result as a toast. */
async function runAction(pluginId: string, actionId: string): Promise<void> {
  try {
    const resp = await runPluginAction(pluginId, { actionId });
    if (resp.error !== undefined && resp.error !== '') { showToast(resp.error); return; }
    if (resp.result?.message !== undefined && resp.result.message !== '') showToast(resp.result.message);
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Plugin action failed');
  }
}

/** Re-fetch the element list and repaint every slot (after enable/disable/install). */
export async function refreshPluginUi(): Promise<void> {
  try { cached = await listPluginUi(); } catch { cached = []; }
  paint();
}

/**
 * Wire the click delegate once and do the initial render (doc 30). The delegate
 * lives on `document.body` (a stable root) so it survives slot repaints.
 */
export async function initPluginUi(): Promise<void> {
  if (!wired) {
    wired = true;
    void delegate(document.body, 'click', '[data-plugin-ui-action]', (_e, el) => {
      const target = asEl(el);
      const pluginId = target.dataset.pluginUiId;
      const actionId = target.dataset.pluginUiAction;
      if (pluginId !== undefined && actionId !== undefined && actionId !== '') void runAction(pluginId, actionId);
    });
  }
  await refreshPluginUi();
}
