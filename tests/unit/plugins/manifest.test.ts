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
  ])('returns null for an invalid manifest: %s', (_label, raw) => {
    expect(parseManifest(raw)).toBeNull();
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
});
