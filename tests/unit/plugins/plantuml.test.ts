/**
 * PlantUML plugin (doc 29, GB-1046): the pure SVG-extraction helper and the
 * fail-soft render paths. The live `java -jar plantuml.jar` render needs a JRE +
 * the jar and is unverifiable in CI (like the Apple FM path) — verified live
 * separately; here we pin that every failure mode yields a null/empty view so the
 * code-block fallback always applies.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import plugin, { extractSvg, renderPuml } from '../../../plugins/plantuml/src/index.js';
import type { ContentRenderer, PluginContext, PluginRegistration } from '../../../plugins/plantuml/src/types.js';

const ctx: PluginContext = {
  log: () => {},
  getSetting: () => Promise.resolve(null),
  setSetting: () => Promise.resolve(),
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gb-puml-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('extractSvg', () => {
  it('trims an XML prolog / DOCTYPE down to <svg', () => {
    expect(extractSvg('<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg>x</svg>')).toBe('<svg>x</svg>');
  });
  it('returns the input when it already starts at <svg', () => {
    expect(extractSvg('<svg a="1"/>')).toBe('<svg a="1"/>');
  });
  it('returns null when there is no <svg', () => {
    expect(extractSvg('java.lang.Exception: syntax error')).toBeNull();
  });
});

describe('renderPuml (fail-soft)', () => {
  it('empty source -> null (no subprocess)', async () => {
    expect(await renderPuml('   ')).toBeNull();
  });
  it('missing jar -> null (no subprocess)', async () => {
    expect(await renderPuml('@startuml\nA->B\n@enduml', join(dir, 'nope.jar'))).toBeNull();
  });
  it('invalid jar / java error -> null (spawn fails or exits non-zero)', async () => {
    const fakeJar = join(dir, 'plantuml.jar');
    writeFileSync(fakeJar, 'not a real jar');
    // With Java present this exits non-zero on the bad jar; without Java the
    // spawn errors — both resolve to null.
    expect(await renderPuml('@startuml\nA->B\n@enduml', fakeJar)).toBeNull();
  });
});

describe('plantuml plugin (doc 29)', () => {
  it('registers a renderer for the PlantUML extensions', async () => {
    const reg = (await plugin.activate(ctx)) as PluginRegistration;
    const r = reg.renderers?.[0] as ContentRenderer;
    expect(r.name).toBe('plantuml');
    expect(r.match.extensions).toEqual(['.puml', '.plantuml', '.pu', '.iuml']);
  });

  it('render() returns an empty view (code-block fallback) when the jar is absent', async () => {
    const reg = (await plugin.activate(ctx)) as PluginRegistration;
    const r = reg.renderers?.[0] as ContentRenderer;
    // No plantuml.jar next to the test-imported source module -> {}.
    const view = await r.render({ bytes: new Uint8Array(), text: '@startuml\nA->B\n@enduml', path: 'd.puml' });
    expect(view).toEqual({});
  });
});
