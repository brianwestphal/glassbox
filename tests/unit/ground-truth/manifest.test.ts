import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGroundTruthManifest } from '../../../src/ground-truth/manifest.js';

// doc 26 P1 — the ground-truth comparison manifest loader.
describe('loadGroundTruthManifest', () => {
  let dir: string;
  const writeManifest = (obj: unknown): string => {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gt-manifest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves relative paths against the manifest directory', () => {
    const p = writeManifest({
      version: 1,
      comparisons: [{ actual: 'out/a.png', expected: 'spec/a.png' }],
    });
    const entries = loadGroundTruthManifest(p);
    expect(entries).toHaveLength(1);
    expect(entries[0].actualPath).toBe(join(dir, 'out/a.png'));
    expect(entries[0].expectedPath).toBe(join(dir, 'spec/a.png'));
    expect(entries[0].key).toBe('out/a.png');
  });

  it('keeps absolute paths as-is (e.g. an expected outside the repo)', () => {
    const abs = isAbsolute('/somewhere/else/design.png') ? '/somewhere/else/design.png' : join(dir, 'design.png');
    const p = writeManifest({
      version: 1,
      comparisons: [{ actual: 'out/a.png', expected: abs }],
    });
    expect(loadGroundTruthManifest(p)[0].expectedPath).toBe(abs);
  });

  it('carries label + expectedKind through', () => {
    const p = writeManifest({
      version: 1,
      comparisons: [{ actual: 'a.png', expected: 'b.png', label: 'Login', expectedKind: 'previous-actual' }],
    });
    const e = loadGroundTruthManifest(p)[0];
    expect(e.label).toBe('Login');
    expect(e.expectedKind).toBe('previous-actual');
  });

  it('deduplicates keys for two same-named actuals', () => {
    const p = writeManifest({
      version: 1,
      comparisons: [
        { actual: 'a.png', expected: 'x.png' },
        { actual: 'a.png', expected: 'y.png' },
      ],
    });
    const entries = loadGroundTruthManifest(p);
    expect(entries.map(e => e.key)).toEqual(['a.png', 'a.png (2)']);
  });

  it('throws for a missing file', () => {
    expect(() => loadGroundTruthManifest(join(dir, 'nope.json'))).toThrow(/Cannot read/);
  });

  it('throws for invalid JSON', () => {
    const p = writeManifest('{ not json');
    expect(() => loadGroundTruthManifest(p)).toThrow(/not valid JSON/);
  });

  it('throws for a schema violation (wrong version, empty comparisons)', () => {
    expect(() => loadGroundTruthManifest(writeManifest({ version: 2, comparisons: [] }))).toThrow(/invalid/);
    expect(() => loadGroundTruthManifest(writeManifest({ version: 1, comparisons: [] }))).toThrow(/invalid/);
    expect(() => loadGroundTruthManifest(writeManifest({ version: 1, comparisons: [{ actual: 'a.png' }] }))).toThrow(/invalid/);
  });

  it('throws when actual or expected is not an image (P1 is images only)', () => {
    const p = writeManifest({
      version: 1,
      comparisons: [{ actual: 'a.txt', expected: 'b.png' }],
    });
    expect(() => loadGroundTruthManifest(p)).toThrow(/not an image/);
  });
});
