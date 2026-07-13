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

import type { ContentPlugin, RenderedView, RenderInput } from './types.js';

type Viz = Awaited<ReturnType<typeof instance>>;
type Engine = 'dot' | 'neato' | 'fdp' | 'circo' | 'twopi';
const ENGINES: readonly Engine[] = ['dot', 'neato', 'fdp', 'circo', 'twopi'];

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
    const stored = await context.getSetting('engine');
    const engine: Engine = ENGINES.includes(stored as Engine) ? (stored as Engine) : 'dot';
    context.log('info', `graphviz plugin activated (.dot / .gv), engine=${engine}`);
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
};

export default plugin;
