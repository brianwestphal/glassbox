/**
 * Glassbox content plugin: Graphviz `.dot` / `.gv` → SVG (doc 29 FR-29.17,
 * GB-1044). The first reference content plugin.
 *
 * Renders server-side via `@viz-js/viz` — a WebAssembly build of Graphviz that
 * needs no DOM and no external process (unlike Mermaid / PlantUML), so it fits
 * the doc-29 server-side-SVG contract cleanly and stays offline. `@viz-js/viz`
 * is bundled into this plugin's self-contained `index.js`; it never enters the
 * Glassbox core.
 *
 * On any parse/render error (an unsupported syntax, invalid source) the renderer
 * returns an empty view, so Glassbox falls back to its committed code block
 * (artifact) / text diff (file) — nothing regresses.
 */
import { instance } from '@viz-js/viz';

import type { ContentPlugin, PluginContext, RenderedView, RenderInput } from './types.js';

type Viz = Awaited<ReturnType<typeof instance>>;
type Engine = 'dot' | 'neato' | 'fdp' | 'circo' | 'twopi';
const ENGINES: readonly Engine[] = ['dot', 'neato', 'fdp', 'circo', 'twopi'];

/** Resolve the configured layout engine (defaulting to `dot`). */
async function resolveEngine(context: PluginContext): Promise<Engine> {
  const stored = await context.getSetting('engine');
  return ENGINES.includes(stored as Engine) ? (stored as Engine) : 'dot';
}

// The WASM instance is created once and reused across renders.
let vizPromise: Promise<Viz> | null = null;
function getViz(): Promise<Viz> {
  return (vizPromise ??= instance());
}

/** Drop any XML prolog / DOCTYPE so the SVG starts at `<svg` — keeps the
 *  `<img>` data URI Glassbox builds compact and unambiguous. */
function normalizeSvg(svg: string): string {
  const i = svg.indexOf('<svg');
  return i > 0 ? svg.slice(i) : svg;
}

async function renderDot(input: RenderInput, engine: Engine): Promise<RenderedView> {
  const source = input.text ?? new TextDecoder().decode(input.bytes);
  if (source.trim() === '') return {};
  try {
    const viz = await getViz();
    const svg = viz.renderString(source, { format: 'svg', engine });
    return typeof svg === 'string' && svg.includes('<svg') ? { svg: normalizeSvg(svg) } : {};
  } catch {
    // Unsupported syntax / render error → empty view → Glassbox code-block fallback.
    return {};
  }
}

const plugin: ContentPlugin = {
  async activate(context) {
    // The layout engine is a user preference (doc 29 FR-29.12); read it at
    // activation (a change re-activates the plugin via reloadContentPlugins).
    const engine = await resolveEngine(context);
    context.log('info', `graphviz plugin activated (.dot / .gv), engine=${engine}`);
    // Reference UI extension (doc 30): a diff-toolbar button that runs the same
    // renderer self-test as the config-layout button and toasts the result.
    context.registerUI([
      {
        type: 'button',
        id: 'graphviz-test',
        location: 'diff-toolbar',
        label: 'Graphviz',
        title: 'Test the Graphviz renderer',
        action: 'test_renderer',
      },
      // Reference stateful control (doc 30 FR-30.3): a toggle whose on/off state
      // the host persists to `stateKey`; onAction reports the new state.
      {
        type: 'toggle',
        id: 'graphviz-grid',
        location: 'sidebar-footer',
        stateKey: 'grid_demo',
        action: 'toggle_grid',
        on: { label: 'Grid: on' },
        off: { label: 'Grid: off' },
      },
    ]);
    return {
      renderers: [
        {
          name: 'graphviz',
          match: { extensions: ['.dot', '.gv'] },
          render: (input) => renderDot(input, engine),
        },
      ],
    };
  },

  // "Test renderer" action, shared by the config-layout button (doc 29 FR-29.18)
  // and the diff-toolbar UI element (doc 30): render a trivial graph with the
  // current engine, report the result as a config-layout status label, and
  // return a `message` so the UI element surfaces a toast.
  async onAction(actionId, context, value) {
    // Stateful toggle (doc 30 FR-30.3): the host has already persisted `value`
    // to the `grid_demo` setting; just acknowledge the new state.
    if (actionId === 'toggle_grid') {
      return { message: `Graphviz grid ${value === 'true' ? 'enabled' : 'disabled'}` };
    }
    if (actionId !== 'test_renderer') return;
    const engine = await resolveEngine(context);
    try {
      const viz = await getViz();
      const svg = viz.renderString('digraph { a -> b }', { format: 'svg', engine });
      if (typeof svg === 'string' && svg.includes('<svg')) {
        context.updateConfigLabel('engine-status', `Renderer OK (${engine})`, 'success');
        return { message: `Graphviz renderer OK (${engine})` };
      }
      context.updateConfigLabel('engine-status', 'Renderer produced no SVG', 'error');
      return { message: 'Graphviz renderer produced no SVG' };
    } catch (e) {
      const msg = `Render failed: ${e instanceof Error ? e.message : String(e)}`;
      context.updateConfigLabel('engine-status', msg, 'error');
      return { message: `Graphviz ${msg}` };
    }
  },
};

export default plugin;
