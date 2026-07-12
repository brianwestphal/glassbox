import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReviewMode } from '../../../src/git/types.js';
import { pluginRendersFile, renderPluginSvgSide } from '../../../src/plugins/fileView.js';
import { __resetContentPluginsForTest, __setContentRegistryForTest } from '../../../src/plugins/index.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import type { ContentRenderer } from '../../../src/plugins/types.js';

const renderer: ContentRenderer = {
  name: 'diagram',
  match: { extensions: ['.dot'] },
  render: (input) => ({ svg: `<svg data-side="${input.side}" data-len="${input.text?.length ?? 0}"/>` }),
};

let rootA: string;
let rootB: string;
let mode: ReviewMode;

beforeEach(() => {
  rootA = mkdtempSync(join(tmpdir(), 'gb-fvA-'));
  rootB = mkdtempSync(join(tmpdir(), 'gb-fvB-'));
  mode = { type: 'diff', pathA: rootA, pathB: rootB };
});
afterEach(() => {
  rmSync(rootA, { recursive: true, force: true });
  rmSync(rootB, { recursive: true, force: true });
  __resetContentPluginsForTest();
});

function withRenderer(): void {
  const reg = new ContentPluginRegistry();
  reg.addRenderers([renderer]);
  __setContentRegistryForTest(reg);
}

describe('pluginRendersFile (doc 29, GB-1052)', () => {
  it('true when a plugin handles the path, false otherwise / when disabled', () => {
    withRenderer();
    expect(pluginRendersFile('graph.dot')).toBe(true);
    expect(pluginRendersFile('graph.png')).toBe(false);
    __resetContentPluginsForTest();
    expect(pluginRendersFile('graph.dot')).toBe(false);
  });
});

describe('renderPluginSvgSide (doc 29, GB-1052)', () => {
  it('renders the new side to SVG', async () => {
    withRenderer();
    writeFileSync(join(rootB, 'g.dot'), 'digraph { A -> B }');
    const svg = await renderPluginSvgSide(mode, 'g.dot', 'g.dot', 'new', rootB);
    expect(svg).toBe('<svg data-side="new" data-len="18"/>');
  });

  it('renders the old side (reads oldPath)', async () => {
    withRenderer();
    writeFileSync(join(rootA, 'old.dot'), 'digraph {}');
    const svg = await renderPluginSvgSide(mode, 'g.dot', 'old.dot', 'old', rootA);
    expect(svg).toContain('data-side="old"');
  });

  it('returns null when no plugin handles the path', async () => {
    withRenderer();
    writeFileSync(join(rootB, 'g.txt'), 'hello');
    expect(await renderPluginSvgSide(mode, 'g.txt', 'g.txt', 'new', rootB)).toBeNull();
  });

  it('returns null for empty source', async () => {
    withRenderer();
    expect(await renderPluginSvgSide(mode, 'g.dot', 'g.dot', 'new', rootB)).toBeNull();
  });

  it('returns null with no plugins installed', async () => {
    __resetContentPluginsForTest();
    writeFileSync(join(rootB, 'g.dot'), 'digraph {}');
    expect(await renderPluginSvgSide(mode, 'g.dot', 'g.dot', 'new', rootB)).toBeNull();
  });
});
