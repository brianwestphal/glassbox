import { describe, expect, it } from 'vitest';

import { ContentPluginRegistry, matches, matchSpecificity, pathMatches } from '../../../src/plugins/registry.js';
import type { ContentRenderer, RenderInput } from '../../../src/plugins/types.js';

function input(over: Partial<RenderInput> = {}): RenderInput {
  return { bytes: new Uint8Array(), path: 'a.mmd', ...over };
}

function renderer(name: string, over: Partial<ContentRenderer> = {}): ContentRenderer {
  return { name, match: { extensions: ['.mmd'] }, render: () => ({ svg: `<svg>${name}</svg>` }), ...over };
}

describe('content matching (doc 29 FR-29.8)', () => {
  it('matches by extension, case-insensitively', () => {
    expect(matches({ extensions: ['.mmd'] }, input({ path: 'diagram.MMD' }))).toBe(true);
    expect(matches({ extensions: ['.dot'] }, input({ path: 'diagram.mmd' }))).toBe(false);
  });

  it('matches by MIME type', () => {
    expect(matches({ mimeTypes: ['text/vnd.mermaid'] }, input({ path: 'x', mime: 'text/vnd.mermaid' }))).toBe(true);
  });

  it('matches by content sniff over the leading bytes', () => {
    const m = { sniff: (b: Uint8Array) => new TextDecoder().decode(b).startsWith('graph ') };
    expect(matches(m, input({ path: 'x', bytes: new TextEncoder().encode('graph TD; A-->B') }))).toBe(true);
    expect(matches(m, input({ path: 'x', bytes: new TextEncoder().encode('nope') }))).toBe(false);
  });

  it('ranks specificity sniff > mime > ext, and a throwing sniff never matches', () => {
    expect(matchSpecificity({ sniff: () => true }, input({ bytes: new Uint8Array([1]) }))).toBe(3);
    expect(matchSpecificity({ mimeTypes: ['m'] }, input({ mime: 'm' }))).toBe(2);
    expect(matchSpecificity({ extensions: ['.mmd'] }, input())).toBe(1);
    expect(matchSpecificity({ sniff: () => { throw new Error('boom'); } }, input({ bytes: new Uint8Array([1]) }))).toBe(0);
  });
});

describe('registry dispatch (doc 29 FR-29.8/29.11)', () => {
  it('returns undefined when nothing matches', () => {
    const reg = new ContentPluginRegistry();
    reg.addRenderers([renderer('a')]);
    expect(reg.findRenderer(input({ path: 'x.dot' }))).toBeUndefined();
  });

  it('picks the higher-priority renderer among matches', () => {
    const reg = new ContentPluginRegistry();
    reg.addRenderers([renderer('low', { priority: 0 }), renderer('high', { priority: 5 })]);
    expect(reg.findRenderer(input())?.name).toBe('high');
  });

  it('prefers a more specific match over a lower-priority-but-broader one at equal priority', () => {
    const reg = new ContentPluginRegistry();
    reg.addRenderers([
      renderer('byExt', { match: { extensions: ['.mmd'] } }),
      renderer('bySniff', { match: { sniff: () => true } }),
    ]);
    expect(reg.findRenderer(input({ bytes: new Uint8Array([1]) }))?.name).toBe('bySniff');
  });

  it('counts registered handlers', () => {
    const reg = new ContentPluginRegistry();
    reg.addRenderers([renderer('a'), renderer('b')]);
    reg.addDiffers(undefined);
    expect(reg.rendererCount).toBe(2);
    expect(reg.differCount).toBe(0);
  });
});

describe('path pre-check (doc 29 FR-29.2, NFR-29.3)', () => {
  it('pathMatches by extension (case-insensitive) and MIME, ignoring sniff', () => {
    expect(pathMatches({ extensions: ['.mmd'] }, 'x.MMD')).toBe(true);
    expect(pathMatches({ mimeTypes: ['m'] }, 'x', 'm')).toBe(true);
    expect(pathMatches({ sniff: () => true }, 'x.mmd')).toBe(false); // sniff-only never path-matches
    expect(pathMatches({ extensions: ['.mmd'] }, 'x.dot')).toBe(false);
  });

  it('mightHandleByPath scans renderers and differs', () => {
    const reg = new ContentPluginRegistry();
    reg.addRenderers([renderer('r', { match: { extensions: ['.mmd'] } })]);
    expect(reg.mightHandleByPath('a.mmd')).toBe(true);
    expect(reg.mightHandleByPath('a.dot')).toBe(false);
    reg.addDiffers([{ name: 'd', match: { extensions: ['.dot'] }, diff: () => ({ html: '' }) }]);
    expect(reg.mightHandleByPath('a.dot')).toBe(true);
  });
});
