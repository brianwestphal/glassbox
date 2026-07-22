/**
 * PlantUML plugin (doc 29, GB-1046): the pure SVG-extraction helper, the
 * fail-soft render paths, and — gated on a JRE + a jar being present — the real
 * `java -jar plantuml.jar` render. The live render is NOT a hardware gate (unlike
 * the Apple FM path): Java is provisionable in CI and the jar is downloadable, so
 * the gated test below actually exercises it wherever the deps exist. It's kept
 * out of the default suite only because the ~22 MB GPL jar isn't committed; point
 * `PLANTUML_JAR` at a jar (or install the plugin via `setup.mjs`) to run it.
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
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

// Live render — runs only when a JRE + a jar are available (provisionable in CI;
// not a hardware gate). Point PLANTUML_JAR at a jar, or install via setup.mjs.
const hasJava = spawnSync('java', ['-version'], { stdio: 'ignore' }).status === 0;
const jarPath = [process.env.PLANTUML_JAR, join(homedir(), '.glassbox', 'plugins', 'plantuml', 'plantuml.jar')]
  .find((p): p is string => typeof p === 'string' && p !== '' && existsSync(p));

describe.skipIf(!hasJava || jarPath === undefined)('plantuml live render (JRE + jar present)', () => {
  // JVM cold start + a real render can exceed vitest's 5s default under
  // full-suite CPU contention (flaked at ~5s while passing in ~3s isolated).
  it('renders real PlantUML source to an SVG containing the diagram content', { timeout: 30_000 }, async () => {
    const svg = await renderPuml('@startuml\nAlice -> Bob: Hello\n@enduml', jarPath);
    expect(svg).not.toBeNull();
    expect(svg?.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Alice');
    expect(svg).not.toContain('<script'); // inert output (doc 29 NFR-29.2)
  });
});
