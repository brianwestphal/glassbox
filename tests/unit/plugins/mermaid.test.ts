/**
 * Mermaid plugin (doc 29, GB-1045): the pure SVG-extraction helper, the CLI-path
 * resolver, the fail-soft render paths, and — gated on `mmdc` being installed —
 * the real headless-browser render. The live render is NOT a hardware gate: a
 * headless browser is provisionable in CI, so the gated test below actually
 * exercises it wherever `mmdc` exists. It's kept out of the default suite only
 * because the browser (~hundreds of MB) isn't committed; point `MERMAID_MMDC` at
 * `@mermaid-js/mermaid-cli`'s `src/cli.js` (or install via `setup.mjs`) to run it.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import plugin, { extractSvg, mmdcCli, renderMermaid } from '../../../plugins/mermaid/src/index.js';
import type { ContentRenderer, PluginContext, PluginRegistration } from '../../../plugins/mermaid/src/types.js';

const ctx: PluginContext = {
  log: () => {},
  getSetting: () => Promise.resolve(null),
  setSetting: () => Promise.resolve(),
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gb-mmd-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('extractSvg', () => {
  it('trims an XML prolog / DOCTYPE down to <svg', () => {
    expect(extractSvg('<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg>x</svg>')).toBe('<svg>x</svg>');
  });
  it('returns the input when it already starts at <svg', () => {
    expect(extractSvg('<svg a="1"/>')).toBe('<svg a="1"/>');
  });
  it('returns null when there is no <svg', () => {
    expect(extractSvg('Error: Parse error on line 1')).toBeNull();
  });
});

describe('mmdcCli', () => {
  it('honors the MERMAID_MMDC override', () => {
    const prev = process.env.MERMAID_MMDC;
    process.env.MERMAID_MMDC = '/custom/cli.js';
    try {
      expect(mmdcCli()).toBe('/custom/cli.js');
    } finally {
      if (prev === undefined) delete process.env.MERMAID_MMDC;
      else process.env.MERMAID_MMDC = prev;
    }
  });
  it('defaults to the plugin-local mermaid-cli entry', () => {
    const prev = process.env.MERMAID_MMDC;
    delete process.env.MERMAID_MMDC;
    try {
      expect(mmdcCli()).toContain(join('node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js'));
    } finally {
      if (prev !== undefined) process.env.MERMAID_MMDC = prev;
    }
  });
});

describe('renderMermaid (fail-soft)', () => {
  it('empty source -> null (no subprocess)', async () => {
    expect(await renderMermaid('   ')).toBeNull();
  });
  it('missing cli -> null (no subprocess)', async () => {
    expect(await renderMermaid('graph TD; A-->B', join(dir, 'nope-cli.js'))).toBeNull();
  });
  it('cli that exits non-zero / produces no SVG -> null', async () => {
    // A trivial script that exits non-zero stands in for a broken/failed mmdc:
    // renderMermaid should treat any non-zero exit (or missing output) as a miss.
    const fakeCli = join(dir, 'cli.js');
    writeFileSync(fakeCli, 'process.exit(1);\n');
    expect(await renderMermaid('graph TD; A-->B', fakeCli)).toBeNull();
  });
});

describe('mermaid plugin (doc 29)', () => {
  it('registers a renderer for the Mermaid extensions', async () => {
    const reg = (await plugin.activate(ctx)) as PluginRegistration;
    const r = reg.renderers?.[0] as ContentRenderer;
    expect(r.name).toBe('mermaid');
    expect(r.match.extensions).toEqual(['.mmd', '.mermaid']);
  });

  it('render() returns an empty view (code-block fallback) when mmdc is absent', async () => {
    const prev = process.env.MERMAID_MMDC;
    process.env.MERMAID_MMDC = join(dir, 'absent-cli.js');
    try {
      const reg = (await plugin.activate(ctx)) as PluginRegistration;
      const r = reg.renderers?.[0] as ContentRenderer;
      const view = await r.render({ bytes: new Uint8Array(), text: 'graph TD; A-->B', path: 'd.mmd' });
      expect(view).toEqual({});
    } finally {
      if (prev === undefined) delete process.env.MERMAID_MMDC;
      else process.env.MERMAID_MMDC = prev;
    }
  });
});

// Live render — runs only when a real `mmdc` (headless browser) is available
// (provisionable in CI; not a hardware gate). Point MERMAID_MMDC at
// mermaid-cli's src/cli.js, or install via setup.mjs.
const mmdcCandidate = [
  process.env.MERMAID_MMDC,
  join(homedir(), '.glassbox', 'plugins', 'mermaid', 'node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js'),
].find((p): p is string => typeof p === 'string' && p !== '' && existsSync(p));

describe.skipIf(mmdcCandidate === undefined)('mermaid live render (mmdc present)', () => {
  it('renders real Mermaid source to an SVG', async () => {
    const svg = await renderMermaid('graph TD; Alice-->Bob', mmdcCandidate);
    expect(svg).not.toBeNull();
    expect(svg?.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('<script'); // inert output (doc 29 NFR-29.2)
  }, 60_000);
});
