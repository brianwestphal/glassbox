/**
 * Mermaid plugin (doc 29, GB-1045): the pure SVG-extraction helper, the CLI-path
 * resolver, the fail-soft render paths, and — gated on `mmdc` being installed —
 * the real headless-browser render. The live render is NOT a hardware gate: a
 * headless browser is provisionable in CI, so the gated test below actually
 * exercises it wherever `mmdc` exists. It's kept out of the default suite only
 * because the browser (~hundreds of MB) isn't committed; point `MERMAID_MMDC` at
 * `@mermaid-js/mermaid-cli`'s `src/cli.js` (or install via `setup.mjs`) to run it.
 */
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import plugin, { extractSvg, mmdcCli, RENDER_TIMEOUT_MS, renderMermaid } from '../../../plugins/mermaid/src/index.js';
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

  /**
   * A subprocess that starts but never exits used to leave the promise pending
   * forever, hanging whatever awaited it — strictly worse than the code-block
   * fallback this degrades to. Surfaced when a real render wedged under a
   * restricted environment and the test died on vitest's timeout instead of
   * fail-softing. The spawned command is `process.execPath <cli>`, so a stand-in
   * CLI that never exits reproduces it exactly.
   */
  it('a subprocess that never exits -> null once the render timeout elapses', async () => {
    const hangingCli = join(dir, 'hang-cli.js');
    writeFileSync(hangingCli, 'setInterval(() => {}, 1000);\n', 'utf-8');

    const started = Date.now();
    // 200 ms so the test is fast; the shipped ceiling is RENDER_TIMEOUT_MS.
    const svg = await renderMermaid('graph TD; A-->B', hangingCli, { timeoutMs: 200 });

    expect(svg).toBeNull();
    // Settled from the timeout, not from the child exiting on its own.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('declares a bounded render timeout', () => {
    expect(RENDER_TIMEOUT_MS).toBeGreaterThan(0);
    expect(RENDER_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
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

/**
 * The plugin swallows every failure into `null` — correct for production (a
 * broken renderer must never break a review) but opaque in a test, where the
 * bare assertion reads "expected null not to be null" and says nothing about
 * why. Re-run the same spawn with stderr captured so a failure explains itself:
 * a browser that can't launch (a locked-down or sandboxed environment) looks
 * nothing like a genuine renderer regression, and the reader should not have to
 * guess which one they're looking at.
 */
function diagnoseMmdc(cli: string): Promise<string> {
  return new Promise(resolve => {
    const workDir = mkdtempSync(join(tmpdir(), 'gb-mmd-diag-'));
    const inFile = join(workDir, 'in.mmd');
    writeFileSync(inFile, 'graph TD; Alice-->Bob', 'utf-8');
    const child = spawn(process.execPath, [cli, '-i', inFile, '-o', join(workDir, 'out.svg'), '-q']);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (err: Error) => { resolve(`spawn failed: ${err.message}`); });
    child.on('close', (code) => {
      rmSync(workDir, { recursive: true, force: true });
      resolve(`mmdc exited ${String(code)}\n${stderr.trim() || '(no stderr)'}`);
    });
  });
}

// …and only under `npm run test:live`. Launching a headless Chromium while ~150
// other test files run concurrently lost the CPU race often enough to make
// `npm test` red on a clean tree — and it failed at browser *launch*, not on
// time, so the existing 60s timeout below could never have saved it. The live
// render is opt-in instead: `vitest.config.live.ts` sets this variable and runs
// the heavy tests without file parallelism.
const live = process.env.GLASSBOX_LIVE_RENDER_TESTS === '1';

describe.skipIf(!live || mmdcCandidate === undefined)('mermaid live render (mmdc present)', () => {
  it('renders real Mermaid source to an SVG', async () => {
    const svg = await renderMermaid('graph TD; Alice-->Bob', mmdcCandidate);
    if (svg === null) {
      throw new Error(`mmdc was found at ${String(mmdcCandidate)} but rendered nothing.\n${await diagnoseMmdc(mmdcCandidate!)}`);
    }
    expect(svg).not.toBeNull();
    expect(svg?.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('<script'); // inert output (doc 29 NFR-29.2)
  }, 60_000);
});
