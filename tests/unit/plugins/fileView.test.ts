import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileDiffSchema } from '../../../src/git/types.js';
import type { ReviewMode } from '../../../src/git/types.js';
import { __resetContentPluginsForTest, __setContentRegistryForTest } from '../../../src/plugins/index.js';
import { renderFileWithPlugins } from '../../../src/plugins/fileView.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import type { ContentDiffer, ContentRenderer } from '../../../src/plugins/types.js';

const renderer: ContentRenderer = {
  name: 'diagram',
  match: { extensions: ['.mmd'] },
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

function diff(over: Record<string, unknown>) {
  return FileDiffSchema.parse({ filePath: 'flow.mmd', ...over });
}
function withRenderer(): void {
  const reg = new ContentPluginRegistry();
  reg.addRenderers([renderer]);
  __setContentRegistryForTest(reg);
}

describe('renderFileWithPlugins (doc 29 FR-29.2)', () => {
  it('returns null when no plugin handles the path (no content read)', async () => {
    withRenderer();
    expect(await renderFileWithPlugins(mode, diff({ filePath: 'a.dot', status: 'added' }), rootB)).toBeNull();
  });

  it('returns null with no plugins installed', async () => {
    __resetContentPluginsForTest();
    expect(await renderFileWithPlugins(mode, diff({ status: 'added' }), rootB)).toBeNull();
  });

  it('returns null for a binary file (out of scope)', async () => {
    withRenderer();
    expect(await renderFileWithPlugins(mode, diff({ isBinary: true, status: 'added' }), rootB)).toBeNull();
  });

  it('renders an added file as a single view (new side)', async () => {
    withRenderer();
    writeFileSync(join(rootB, 'flow.mmd'), 'graph TD; A-->B');
    const view = await renderFileWithPlugins(mode, diff({ status: 'added' }), rootB);
    expect(view).toEqual({ kind: 'single', view: { svg: '<svg data-side="new" data-len="15"/>' } });
  });

  it('renders a deleted file as a single view (old side)', async () => {
    withRenderer();
    writeFileSync(join(rootA, 'flow.mmd'), 'graph');
    const view = await renderFileWithPlugins(mode, diff({ status: 'deleted' }), rootB);
    expect(view).toEqual({ kind: 'single', view: { svg: '<svg data-side="old" data-len="5"/>' } });
  });

  it('prefers a differ for a modified file (single view)', async () => {
    const differ: ContentDiffer = {
      name: 'd', match: { extensions: ['.mmd'] },
      diff: (input) => ({ html: `<div>${input.old.text}|${input.new.text}</div>` }),
    };
    const reg = new ContentPluginRegistry();
    reg.addRenderers([renderer]);
    reg.addDiffers([differ]);
    __setContentRegistryForTest(reg);
    writeFileSync(join(rootA, 'flow.mmd'), 'OLD');
    writeFileSync(join(rootB, 'flow.mmd'), 'NEW');
    const view = await renderFileWithPlugins(mode, diff({ status: 'modified' }), rootB);
    expect(view).toEqual({ kind: 'single', view: { html: '<div>OLD|NEW</div>' } });
  });

  it('renders each side for a modified file when only a renderer matches (pair)', async () => {
    withRenderer();
    writeFileSync(join(rootA, 'flow.mmd'), 'OLD');
    writeFileSync(join(rootB, 'flow.mmd'), 'NEWER');
    const view = await renderFileWithPlugins(mode, diff({ status: 'modified' }), rootB);
    expect(view).toEqual({
      kind: 'pair',
      old: { svg: '<svg data-side="old" data-len="3"/>' },
      new: { svg: '<svg data-side="new" data-len="5"/>' },
    });
  });
});
