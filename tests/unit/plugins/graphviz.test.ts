import { describe, expect, it } from 'vitest';

import plugin from '../../../plugins/graphviz/src/index.js';
import type { ConfigLabelColor, ContentRenderer, PluginContext, PluginRegistration } from '../../../plugins/graphviz/src/types.js';

interface RecordingContext extends PluginContext {
  labels: Record<string, { text: string; color?: ConfigLabelColor }>;
}

function ctxWith(settings: Record<string, string> = {}): RecordingContext {
  const labels: RecordingContext['labels'] = {};
  return {
    labels,
    log: () => {},
    getSetting: (key) => Promise.resolve(settings[key] ?? null),
    setSetting: () => Promise.resolve(),
    updateConfigLabel: (labelId, text, color) => { labels[labelId] = { text, color }; },
  };
}

async function getRenderer(settings: Record<string, string> = {}): Promise<ContentRenderer> {
  const reg = (await plugin.activate(ctxWith(settings))) as PluginRegistration;
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

  it('applies the `engine` preference (doc 29 FR-29.12)', async () => {
    const dot = { bytes: new Uint8Array(), text: 'digraph { A -> B -> C }', path: 'g.dot' };
    const withDot = await (await getRenderer({ engine: 'dot' })).render(dot);
    const withNeato = await (await getRenderer({ engine: 'neato' })).render(dot);
    expect(withDot.svg).toContain('<svg');
    expect(withNeato.svg).toContain('<svg');
    // Different layout engines produce different geometry.
    expect(withDot.svg).not.toBe(withNeato.svg);
  });

  it('ignores an invalid engine value and still renders', async () => {
    const r = await getRenderer({ engine: 'bogus' });
    const view = await r.render({ bytes: new Uint8Array(), text: 'digraph { A -> B }', path: 'g.dot' });
    expect(view.svg).toContain('<svg');
  });

  // Config-layout "Test renderer" button (doc 29 FR-29.18).
  it('onAction(test_renderer) sets a success status label with the engine', async () => {
    const ctx = ctxWith({ engine: 'neato' });
    await plugin.onAction?.('test_renderer', ctx);
    expect(ctx.labels['engine-status']).toEqual({ text: 'Renderer OK (neato)', color: 'success' });
  });

  it('onAction ignores an unknown action id (no label set)', async () => {
    const ctx = ctxWith();
    await plugin.onAction?.('nope', ctx);
    expect(ctx.labels['engine-status']).toBeUndefined();
  });
});
