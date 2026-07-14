/**
 * Glassbox content plugin: PlantUML `.puml` → SVG (doc 29, GB-1046).
 *
 * PlantUML has no pure-JS/WASM engine (it's a Java application), so — unlike the
 * DOM-less Graphviz WASM plugin — this renders by spawning a **local**
 * `java -jar plantuml.jar -pipe -tsvg` subprocess: source in on stdin, SVG out on
 * stdout. A local subprocess keeps rendering **offline** (local-first). The plugin
 * is **separately installable** (`autoInstall: false`): it is not force-installed,
 * so core stays lean and no one is required to have Java — the user opts in and
 * runs `setup.mjs` to check Java + fetch `plantuml.jar` into this dir.
 *
 * Fail-soft: no `java`, no `plantuml.jar`, or any render/parse error yields an
 * empty view, so Glassbox falls back to its committed code block / text diff —
 * nothing regresses.
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type { ContentPlugin, RenderedView, RenderInput } from './types.js';

const EXTENSIONS = ['.puml', '.plantuml', '.pu', '.iuml'];

/** The bundled jar path: `plantuml.jar` next to this plugin's entry module. */
export function jarPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'plantuml.jar');
}

/** Trim anything before `<svg` (XML prolog / DOCTYPE); null if there's no SVG. */
export function extractSvg(out: string): string | null {
  const i = out.indexOf('<svg');
  return i >= 0 ? out.slice(i) : null;
}

/**
 * Render PlantUML source to SVG via `java -jar plantuml.jar -pipe -tsvg`. Resolves
 * to the SVG string, or `null` on any failure (empty source, missing jar, `java`
 * not on PATH, non-zero exit, no SVG in the output) — the caller falls back.
 */
export function renderPuml(source: string, jar: string = jarPath()): Promise<string | null> {
  if (source.trim() === '' || !existsSync(jar)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null): void => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn('java', ['-jar', jar, '-pipe', '-tsvg', '-charset', 'UTF-8']);
    } catch {
      finish(null);
      return;
    }
    let out = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf-8'); });
    child.on('error', () => finish(null)); // `java` not found, etc.
    child.on('close', (code) => finish(code === 0 ? extractSvg(out) : null));
    child.stdin.on('error', () => { /* ignore EPIPE if java exits before we finish writing */ });
    child.stdin.end(source);
  });
}

const plugin: ContentPlugin = {
  activate(context) {
    context.log('info', `plantuml plugin activated (${EXTENSIONS.join(' / ')})`);
    return {
      renderers: [
        {
          name: 'plantuml',
          match: { extensions: EXTENSIONS },
          async render(input: RenderInput): Promise<RenderedView> {
            const source = input.text ?? new TextDecoder().decode(input.bytes);
            const svg = await renderPuml(source);
            return svg !== null ? { svg } : {};
          },
        },
      ],
    };
  },
};

export default plugin;
