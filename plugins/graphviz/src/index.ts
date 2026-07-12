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

async function renderDot(input: RenderInput): Promise<RenderedView> {
  const source = input.text ?? new TextDecoder().decode(input.bytes);
  if (source.trim() === '') return {};
  try {
    const viz = await getViz();
    const svg = viz.renderString(source, { format: 'svg' });
    return typeof svg === 'string' && svg.includes('<svg') ? { svg: normalizeSvg(svg) } : {};
  } catch {
    // Unsupported syntax / render error → empty view → Glassbox code-block fallback.
    return {};
  }
}

const plugin: ContentPlugin = {
  activate(context) {
    context.log('info', 'graphviz plugin activated (.dot / .gv)');
    return {
      renderers: [
        {
          name: 'graphviz',
          match: { extensions: ['.dot', '.gv'] },
          render: renderDot,
        },
      ],
    };
  },
};

export default plugin;
