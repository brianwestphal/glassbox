/**
 * Glassbox content plugin: Mermaid `.mmd` / `.mermaid` → SVG (doc 29, GB-1045).
 *
 * Mermaid is fundamentally a **browser** library — it measures text via the DOM
 * (`getBBox`), so there is no DOM-free / WASM engine (unlike the Graphviz
 * plugin's `@viz-js/viz`). The maintained Node renderers all drive a **headless
 * browser**; the canonical one is `@mermaid-js/mermaid-cli` (`mmdc`) over
 * puppeteer/Chromium. So — mirroring the PlantUML plugin's `java -jar` approach —
 * this renders by spawning a **local** `mmdc` subprocess: source in, SVG out. A
 * local subprocess keeps rendering **offline / local-first** (nothing is sent to
 * a network service).
 *
 * Because it needs a headless browser, this plugin is **separately installable**
 * (`autoInstall: false`): it is not force-installed, so core stays lean and no
 * one is required to have Chromium — the user opts in and runs `setup.mjs`, which
 * installs `@mermaid-js/mermaid-cli` + puppeteer (fetching a Chromium) into the
 * plugin's install dir.
 *
 * Fail-soft: no `mmdc`, a spawn/render error, or empty output yields an empty
 * view, so Glassbox falls back to its committed code block / text diff — nothing
 * regresses.
 */
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type { ContentPlugin, RenderedView, RenderInput } from './types.js';

const EXTENSIONS = ['.mmd', '.mermaid'];

/**
 * Resolve the `mmdc` CLI entry (`@mermaid-js/mermaid-cli`'s `src/cli.js`).
 * `MERMAID_MMDC` overrides it; otherwise it's the one `setup.mjs` installed into
 * this plugin's own `node_modules`. We run it with `node <cli.js>` (not the
 * `.bin/mmdc` shim) to sidestep shebang / `.cmd` cross-platform quirks.
 */
export function mmdcCli(): string {
  const override = process.env.MERMAID_MMDC;
  if (typeof override === 'string' && override !== '') return override;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js');
}

/** Trim anything before `<svg` (XML prolog / DOCTYPE); null if there's no SVG. */
export function extractSvg(out: string): string | null {
  const i = out.indexOf('<svg');
  return i >= 0 ? out.slice(i) : null;
}

/**
 * Render Mermaid source to SVG via a local `mmdc` subprocess. Resolves to the SVG
 * string, or `null` on any failure (empty source, `mmdc` not installed, spawn
 * error, non-zero exit, no SVG produced) — the caller falls back to the code
 * block. `MERMAID_PUPPETEER_CONFIG` (a JSON file, e.g. `{"args":["--no-sandbox"]}`)
 * is passed through to `mmdc -p` for locked-down / rootless environments.
 */
export function renderMermaid(source: string, cli: string = mmdcCli()): Promise<string | null> {
  if (source.trim() === '' || !existsSync(cli)) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let workDir: string | null = null;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      if (workDir !== null) {
        try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
      }
      resolve(v);
    };
    let outFile: string;
    let child;
    try {
      workDir = mkdtempSync(join(tmpdir(), 'gb-mmd-'));
      const inFile = join(workDir, 'in.mmd');
      outFile = join(workDir, 'out.svg');
      writeFileSync(inFile, source, 'utf-8');
      const args = [cli, '-i', inFile, '-o', outFile, '-q'];
      const puppeteerConfig = process.env.MERMAID_PUPPETEER_CONFIG;
      if (typeof puppeteerConfig === 'string' && puppeteerConfig !== '') args.push('-p', puppeteerConfig);
      child = spawn(process.execPath, args, { stdio: 'ignore' });
    } catch {
      finish(null);
      return;
    }
    child.on('error', () => finish(null)); // node/mmdc failed to launch
    child.on('close', (code) => {
      if (code !== 0 || !existsSync(outFile)) { finish(null); return; }
      try {
        finish(extractSvg(readFileSync(outFile, 'utf-8')));
      } catch {
        finish(null);
      }
    });
  });
}

const plugin: ContentPlugin = {
  activate(context) {
    context.log('info', `mermaid plugin activated (${EXTENSIONS.join(' / ')})`);
    return {
      renderers: [
        {
          name: 'mermaid',
          match: { extensions: EXTENSIONS },
          async render(input: RenderInput): Promise<RenderedView> {
            const source = input.text ?? new TextDecoder().decode(input.bytes);
            const svg = await renderMermaid(source);
            return svg !== null ? { svg } : {};
          },
        },
      ],
    };
  },
};

export default plugin;
