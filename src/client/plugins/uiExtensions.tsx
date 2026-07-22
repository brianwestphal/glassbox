/**
 * Plugin UI extensions (doc 30): render a plugin's registered UI elements into
 * the predefined host locations (`header`, `diff-toolbar`, `sidebar-footer`) and
 * round-trip clicks to the plugin's `onAction` via `POST /api/plugins/:id/action`.
 *
 * Elements are declarative (icon + label + action id — the plugin ships no DOM);
 * the host builds every node and owns the click wiring. All five element types
 * render: `button` + `link`, and the stateful `toggle` / `switch` /
 * `segmented-control`, whose state the host persists to the element's
 * `stateKey` and resolves back into `value` on each list fetch.
 */
import { delegate, raw } from 'kerfjs';

import type { PluginUIElementInfo } from '../../api/index.js';
import { listPluginUi, runPluginAction } from '../../api/index.js';
import { asEl, toElement } from '../dom.js';
import { showToast } from '../toast.js';
import { asSelectionMode, encodeSelection, nextSelection, parseSelection } from './segmentSelection.js';

/** Location id → the server-rendered slot's DOM id (reviewShell.tsx). */
const SLOTS: Record<string, string> = {
  header: 'plugin-ui-header',
  'diff-toolbar': 'plugin-ui-diff-toolbar',
  'sidebar-footer': 'plugin-ui-sidebar-footer',
};

let cached: PluginUIElementInfo[] = [];
let wired = false;

/** An inline-SVG icon node (inert; trusted per opt-in install), or null. */
function iconNode(icon: string | undefined): HTMLElement | null {
  if (icon === undefined || icon === '') return null;
  // eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- plugin-supplied inert SVG icon; installed plugins are trusted (doc 29 §29.6).
  return toElement(<span className="plugin-ui-icon">{raw(icon)}</span>);
}

/** Build a face (label + icon) into a button-like element. */
function faceContent(btn: HTMLElement, icon: string | undefined, label: string | undefined): void {
  const i = iconNode(icon);
  if (i !== null) btn.appendChild(i);
  if (label !== undefined && label !== '') btn.appendChild(toElement(<span className="plugin-ui-label">{label}</span>));
}

/** Build an element for any supported type; null for one the host can't render. */
function renderElement(el: PluginUIElementInfo): HTMLElement | null {
  const action = el.action;
  if (el.type === 'button') {
    const cls = `plugin-ui-btn${el.style === 'primary' ? ' primary' : ''}${el.style === 'danger' ? ' danger' : ''}`;
    const btn = toElement(
      <button type="button" className={cls} title={el.title ?? el.label ?? ''}
        data-plugin-ui-id={el.pluginId} data-plugin-ui-action={el.action ?? ''} />,
    );
    faceContent(btn, el.icon, el.label);
    return btn;
  }
  if (el.type === 'link' && el.url !== undefined && el.url !== '') {
    const a = toElement(<a className="plugin-ui-link" href={el.url} target="_blank" rel="noopener noreferrer" title={el.title ?? ''} />);
    faceContent(a, el.icon, el.label);
    return a;
  }
  // Stateful controls (doc 30 FR-30.3). Direct listeners (not the delegate) so we
  // can compute the new value; they're rebuilt on every repaint (no stale binds).
  if (action === undefined || action === '') return null;
  if (el.type === 'toggle') {
    const on = el.value === 'true';
    const face = on ? el.on : el.off;
    const btn = toElement(
      <button type="button" className={`plugin-ui-btn plugin-ui-toggle${on ? ' active' : ''}${face?.style === 'primary' ? ' primary' : ''}`}
        title={face?.title ?? face?.label ?? el.title ?? ''} aria-pressed={on ? 'true' : 'false'} />,
    );
    faceContent(btn, face?.icon, face?.label);
    btn.addEventListener('click', () => void runAction(el.pluginId, action, on ? 'false' : 'true'));
    return btn;
  }
  if (el.type === 'switch') {
    const on = el.value === 'true';
    const btn = toElement(
      <button type="button" className={`plugin-ui-btn plugin-ui-switch${on ? ' active' : ''}`}
        title={el.title ?? ''} aria-pressed={on ? 'true' : 'false'}>
        <span className="plugin-ui-label">{on ? el.onLabel ?? 'On' : el.offLabel ?? 'Off'}</span>
      </button>,
    );
    btn.addEventListener('click', () => void runAction(el.pluginId, action, on ? 'false' : 'true'));
    return btn;
  }
  if (el.type === 'segmented-control') {
    const mode = asSelectionMode(el.selectionMode);
    const selected = parseSelection(el.value);
    const group = toElement(<div className="plugin-ui-segmented segmented-control" role="group" title={el.title ?? ''} />);
    for (const seg of el.segments ?? []) {
      const active = selected.includes(seg.id);
      const segBtn = toElement(<button type="button" className={`segment${active ? ' active' : ''}`} title={seg.title ?? seg.label ?? ''} />);
      faceContent(segBtn, seg.icon, seg.label ?? seg.id);
      segBtn.addEventListener('click', () => {
        void runAction(el.pluginId, action, encodeSelection(mode, nextSelection(mode, selected, seg.id)));
      });
      group.appendChild(segBtn);
    }
    return group;
  }
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

/** Run a UI-element action; surface an error / `message` result as a toast. When
 *  a stateful control passes a `value`, repaint afterward so the new persisted
 *  state (doc 30 FR-30.3) is reflected. */
async function runAction(pluginId: string, actionId: string, value?: string): Promise<void> {
  try {
    const resp = await runPluginAction(pluginId, { actionId, value });
    if (resp.error !== undefined && resp.error !== '') showToast(resp.error);
    else if (resp.result?.message !== undefined && resp.result.message !== '') showToast(resp.result.message);
    if (value !== undefined) await refreshPluginUi();
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
