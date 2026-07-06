import { afterEach, describe, expect, it } from 'vitest';

import { __resetContentPluginsForTest, __setContentRegistryForTest } from '../../../src/plugins/index.js';
import { renderNoteArtifacts } from '../../../src/plugins/artifacts.js';
import { ContentPluginRegistry } from '../../../src/plugins/registry.js';
import type { ContentRenderer } from '../../../src/plugins/types.js';
import type { ReviewNoteView } from '../../../src/review-notes/view.js';

const mmdRenderer: ContentRenderer = {
  name: 'diagram',
  match: { extensions: ['.mmd'] },
  render: () => ({ svg: '<svg id="rendered"/>' }),
};

function view(over: Partial<ReviewNoteView> = {}): ReviewNoteView {
  return { line: 1, side: 'new', kind: 'proof', body: 'b', ...over };
}

afterEach(() => __resetContentPluginsForTest());

describe('renderNoteArtifacts (doc 29 FR-29.2/29.13)', () => {
  it('renders a matching text artifact into inert SVG in place of the code block', async () => {
    const reg = new ContentPluginRegistry();
    reg.addRenderers([mmdRenderer]);
    __setContentRegistryForTest(reg);

    const views = [view({ artifacts: [{ uri: 'proof/flow.mmd', content: 'graph TD; A-->B' }] })];
    await renderNoteArtifacts(views);
    expect(views[0].artifacts?.[0].renderedSvg).toBe('<svg id="rendered"/>');
  });

  it('leaves a non-matching text artifact untouched (code-block fallback)', async () => {
    const reg = new ContentPluginRegistry();
    reg.addRenderers([mmdRenderer]);
    __setContentRegistryForTest(reg);

    const views = [view({ artifacts: [{ uri: 'log.txt', content: 'hello' }] })];
    await renderNoteArtifacts(views);
    expect(views[0].artifacts?.[0].renderedSvg).toBeUndefined();
    expect(views[0].artifacts?.[0].renderedHtml).toBeUndefined();
  });

  it('never offers an image artifact to the dispatcher', async () => {
    const reg = new ContentPluginRegistry();
    // A renderer that would match anything — proves images are skipped upstream.
    reg.addRenderers([{ name: 'any', match: { sniff: () => true }, render: () => ({ svg: '<svg/>' }) }]);
    __setContentRegistryForTest(reg);

    const views = [view({ artifacts: [{ uri: 'shot.png', isImage: true }] })];
    await renderNoteArtifacts(views);
    expect(views[0].artifacts?.[0].renderedSvg).toBeUndefined();
  });

  it('is a no-op with no plugins installed (zero-plugin no-op, NFR-29.3)', async () => {
    __resetContentPluginsForTest(); // empty, uninitialized registry
    const views = [view({ artifacts: [{ uri: 'proof/flow.mmd', content: 'graph TD' }] })];
    await renderNoteArtifacts(views);
    expect(views[0].artifacts?.[0].renderedSvg).toBeUndefined();
    expect(views[0].artifacts?.[0].content).toBe('graph TD');
  });
});
