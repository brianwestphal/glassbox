import { describe, expect, it } from 'vitest';

import plugin from '../../../plugins/graphviz/src/index.js';
import type { ContentRenderer, PluginContext, PluginRegistration } from '../../../plugins/graphviz/src/types.js';

const noopCtx: PluginContext = {
  log: () => {},
  getSetting: () => Promise.resolve(null),
  setSetting: () => Promise.resolve(),
};

async function getRenderer(): Promise<ContentRenderer> {
  const reg = (await plugin.activate(noopCtx)) as PluginRegistration;
  const r = reg.renderers?.[0];
  if (r === undefined) throw new Error('no renderer registered');
  return r;
}

describe('graphviz plugin (doc 29 FR-29.17)', () => {
  it('declares a renderer for .dot / .gv', async () => {
    const r = await getRenderer();
    expect(r.name).toBe('graphviz');
    expect(r.match.extensions).toEqual(['.dot', '.gv']);
  });

  it('renders valid DOT source to inert SVG (server-side, no DOM)', async () => {
    const r = await getRenderer();
    const view = await r.render({ bytes: new Uint8Array(), text: 'digraph { A -> B -> C }', path: 'g.dot' });
    expect(view.svg).toBeDefined();
    expect(view.svg?.startsWith('<svg')).toBe(true);
    expect(view.svg).toContain('</svg>');
    // No script / external resource loads in the output (inert; doc 29 NFR-29.2).
    expect(view.svg).not.toContain('<script');
    expect(view.html).toBeUndefined();
  });

  it('reads from bytes when text is absent', async () => {
    const r = await getRenderer();
    const view = await r.render({ bytes: new TextEncoder().encode('graph { X -- Y }'), path: 'g.gv' });
    expect(view.svg?.startsWith('<svg')).toBe(true);
  });

  it('returns an empty view for empty source (code-block fallback)', async () => {
    const r = await getRenderer();
    expect(await r.render({ bytes: new Uint8Array(), text: '   ', path: 'g.dot' })).toEqual({});
  });

  it('returns an empty view (no throw) on invalid DOT (fallback, FR-29.14)', async () => {
    const r = await getRenderer();
    expect(await r.render({ bytes: new Uint8Array(), text: 'this is not valid dot {{{', path: 'g.dot' })).toEqual({});
  });
});
