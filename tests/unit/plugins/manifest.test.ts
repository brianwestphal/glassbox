import { describe, expect, it } from 'vitest';

import { parseManifest } from '../../../src/plugins/manifest.js';

describe('plugin manifest (doc 29 FR-29.4)', () => {
  it('accepts a minimal valid manifest', () => {
    const m = parseManifest({ id: 'diagram', name: 'Diagram', version: '1.0.0' });
    expect(m).not.toBeNull();
    expect(m?.id).toBe('diagram');
    expect(m?.entry).toBeUndefined();
  });

  it('keeps unknown keys (loose) but validates the required ones', () => {
    const m = parseManifest({ id: 'x', name: 'X', version: '2', entry: 'main.js', extra: { foo: 1 } });
    expect(m?.entry).toBe('main.js');
    expect((m as Record<string, unknown>).extra).toEqual({ foo: 1 });
  });

  it('parses declared contentTypes', () => {
    const m = parseManifest({
      id: 'x', name: 'X', version: '1',
      contentTypes: [{ extensions: ['.mmd'], mimeTypes: ['text/vnd.mermaid'] }],
    });
    expect(m?.contentTypes?.[0]?.extensions).toEqual(['.mmd']);
  });

  it.each([
    ['missing id', { name: 'X', version: '1' }],
    ['empty id', { id: '', name: 'X', version: '1' }],
    ['missing version', { id: 'x', name: 'X' }],
    ['not an object', 'nope'],
    ['null', null],
    // Unsafe ids (GB-1081): the id is a filesystem path segment ahead of a
    // recursive rmSync, so path separators and leading dots must fail.
    ['traversal id', { id: '../escape', name: 'X', version: '1' }],
    ['id with slash', { id: 'a/b', name: 'X', version: '1' }],
    ['id with backslash', { id: 'a\\b', name: 'X', version: '1' }],
    ['leading-dot id', { id: '.hidden', name: 'X', version: '1' }],
    ['bare dot-dot id', { id: '..', name: 'X', version: '1' }],
  ])('returns null for an invalid manifest: %s', (_label, raw) => {
    expect(parseManifest(raw)).toBeNull();
  });

  it('accepts real-world slug ids (image-codecs, dots, underscores)', () => {
    for (const id of ['image-codecs', 'my.plugin_v2', 'A1']) {
      expect(parseManifest({ id, name: 'X', version: '1' })?.id).toBe(id);
    }
  });

  // Config layout (doc 29 FR-29.18).
  it('parses a nested configLayout (group / divider / spacer / label / button)', () => {
    const m = parseManifest({
      id: 'x', name: 'X', version: '1',
      preferences: [{ key: 'engine', label: 'Engine', type: 'select', options: ['dot'] }],
      configLayout: [
        { type: 'divider' },
        { type: 'spacer' },
        { type: 'label', id: 's', text: 'Not tested', color: 'transient' },
        { type: 'button', id: 'b', label: 'Test', action: 'test', style: 'primary' },
        { type: 'group', title: 'Rendering', collapsed: true, items: [
          { type: 'preference', key: 'engine' },
        ] },
      ],
    });
    expect(m?.configLayout).toHaveLength(5);
    const group = m?.configLayout?.[4];
    expect(group?.type).toBe('group');
    expect(group?.items?.[0]).toEqual({ type: 'preference', key: 'engine' });
    expect(m?.configLayout?.[2]).toEqual({ type: 'label', id: 's', text: 'Not tested', color: 'transient' });
  });

  it('rejects an invalid configLayout label color', () => {
    expect(parseManifest({
      id: 'x', name: 'X', version: '1',
      configLayout: [{ type: 'label', id: 's', text: 'hi', color: 'chartreuse' }],
    })).toBeNull();
  });

  it('rejects an unknown configLayout item type', () => {
    expect(parseManifest({
      id: 'x', name: 'X', version: '1',
      configLayout: [{ type: 'widget' }],
    })).toBeNull();
  });

  // The install descriptor (doc 29 §29.2, GB-1069).
  it('parses install requirements + a fetch provision step', () => {
    const m = parseManifest({
      id: 'puml', name: 'PlantUML', version: '1', autoInstall: false,
      install: {
        requirements: [{ id: 'java', label: 'Java', command: 'java', checkArgs: ['-version'], hint: 'install a JRE', docUrl: 'https://adoptium.net' }],
        provision: [{ kind: 'fetch', url: 'https://x/plantuml.jar', dest: 'plantuml.jar', sha256: 'abc' }],
        cliHint: 'node setup.mjs',
      },
    });
    expect(m).not.toBeNull();
    expect(m?.install?.requirements?.[0]).toMatchObject({ id: 'java', command: 'java' });
    const step = m?.install?.provision?.[0];
    expect(step?.kind).toBe('fetch');
    if (step?.kind === 'fetch') expect(step.dest).toBe('plantuml.jar');
    expect(m?.install?.cliHint).toBe('node setup.mjs');
  });

  it('parses an npm-install provision step (the other union variant)', () => {
    const m = parseManifest({
      id: 'mmd', name: 'Mermaid', version: '1', autoInstall: false,
      install: { provision: [{ kind: 'npm-install', packages: ['@mermaid-js/mermaid-cli@11', 'puppeteer@24'], requires: 'npm', note: 'downloads Chromium' }] },
    });
    const step = m?.install?.provision?.[0];
    expect(step?.kind).toBe('npm-install');
    if (step?.kind === 'npm-install') {
      expect(step.packages).toEqual(['@mermaid-js/mermaid-cli@11', 'puppeteer@24']);
      expect(step.requires).toBe('npm');
    }
  });

  it('rejects an unknown provision step kind', () => {
    expect(parseManifest({
      id: 'x', name: 'X', version: '1',
      install: { provision: [{ kind: 'brew-install', packages: ['x'] }] },
    })).toBeNull();
  });

  it('rejects an npm-install step with no packages', () => {
    expect(parseManifest({
      id: 'x', name: 'X', version: '1',
      install: { provision: [{ kind: 'npm-install', packages: [] }] },
    })).toBeNull();
  });

  it('a manifest with no install descriptor still parses (self-contained)', () => {
    const m = parseManifest({ id: 'codec', name: 'Codecs', version: '1', autoInstall: false });
    expect(m).not.toBeNull();
    expect(m?.install).toBeUndefined();
  });
});
