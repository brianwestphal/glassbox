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

  it('throws when actual or expected is not an image (images only)', () => {
    const p = writeManifest({
      version: 1,
      comparisons: [{ actual: 'a.txt', expected: 'b.png' }],
    });
    expect(() => loadGroundTruthManifest(p)).toThrow(/not an image/);
  });

  it('throws for an unsupported version', () => {
    const p = writeManifest({ version: 3, comparisons: [{ actual: 'a.png', expected: 'b.png' }] });
    expect(() => loadGroundTruthManifest(p)).toThrow(/unsupported version 3/);
  });
});

// doc 26 P3a — version: 2 sets / multi-step flows.
describe('loadGroundTruthManifest — version 2 sets', () => {
  let dir: string;
  const writeManifest = (obj: unknown): string => {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gt-manifest-v2-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a v2 manifest with only comparisons (back-compat shape)', () => {
    const p = writeManifest({
      version: 2,
      comparisons: [{ actual: 'out/a.png', expected: 'spec/a.png' }],
    });
    const entries = loadGroundTruthManifest(p);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('out/a.png');
    expect(entries[0].setIndex).toBeUndefined();
  });

  it('resolves a set to one ordered entry per step with derived keys', () => {
    const p = writeManifest({
      version: 2,
      sets: [
        {
          label: 'Checkout flow',
          steps: [
            { actual: 'out/checkout/1-cart.png', expected: 'design/checkout/1-cart.png', label: 'Cart' },
            { actual: 'out/checkout/2-address.png', expected: 'design/checkout/2-address.png', label: 'Address' },
          ],
        },
      ],
    });
    const entries = loadGroundTruthManifest(p);
    expect(entries.map(e => e.key)).toEqual(['set:0/0-1-cart.png', 'set:0/1-2-address.png']);
    expect(entries.map(e => e.label)).toEqual(['Cart', 'Address']);
    expect(entries.map(e => e.setIndex)).toEqual([0, 0]);
    expect(entries.map(e => e.setLabel)).toEqual(['Checkout flow', 'Checkout flow']);
    expect(entries.map(e => e.stepIndex)).toEqual([0, 1]);
    expect(entries.map(e => e.stepCount)).toEqual([2, 2]);
    expect(entries[0].actualPath).toBe(join(dir, 'out/checkout/1-cart.png'));
    expect(entries[0].expectedPath).toBe(join(dir, 'design/checkout/1-cart.png'));
  });

  it('inherits the set expectedKind into steps, letting a step override', () => {
    const p = writeManifest({
      version: 2,
      sets: [
        {
          label: 'Flow',
          expectedKind: 'spec',
          steps: [
            { actual: 'a.png', expected: 'a-spec.png' },
            { actual: 'b.png', expected: 'b-prev.png', expectedKind: 'previous-actual' },
          ],
        },
      ],
    });
    const entries = loadGroundTruthManifest(p);
    expect(entries.map(e => e.expectedKind)).toEqual(['spec', 'previous-actual']);
  });

  it('emits singles first, then set steps in order', () => {
    const p = writeManifest({
      version: 2,
      comparisons: [{ actual: 'single.png', expected: 'single-spec.png', label: 'Single' }],
      sets: [{ label: 'Flow', steps: [{ actual: 'step.png', expected: 'step-spec.png' }] }],
    });
    const entries = loadGroundTruthManifest(p);
    expect(entries.map(e => e.key)).toEqual(['single.png', 'set:0/0-step.png']);
    expect(entries[0].setIndex).toBeUndefined();
    expect(entries[1].setIndex).toBe(0);
  });

  it('deduplicates step keys when basenames repeat across sets', () => {
    const p = writeManifest({
      version: 2,
      sets: [
        { label: 'A', steps: [{ actual: 'x/home.png', expected: 'x/home-spec.png' }] },
        { label: 'B', steps: [{ actual: 'y/home.png', expected: 'y/home-spec.png' }] },
      ],
    });
    const entries = loadGroundTruthManifest(p);
    // Distinct set indices already keep keys apart, so no "(2)" suffix is needed.
    expect(entries.map(e => e.key)).toEqual(['set:0/0-home.png', 'set:1/0-home.png']);
  });

  it('throws for a v2 manifest with neither comparisons nor sets', () => {
    expect(() => loadGroundTruthManifest(writeManifest({ version: 2 }))).toThrow(/invalid/);
    expect(() => loadGroundTruthManifest(writeManifest({ version: 2, comparisons: [], sets: [] }))).toThrow(/invalid/);
  });

  it('throws for an empty set (a set needs at least one step)', () => {
    expect(() =>
      loadGroundTruthManifest(writeManifest({ version: 2, sets: [{ label: 'Empty', steps: [] }] })),
    ).toThrow(/invalid/);
  });

  it('throws when a set step is not an image', () => {
    const p = writeManifest({
      version: 2,
      sets: [{ label: 'Flow', steps: [{ actual: 'a.txt', expected: 'b.png' }] }],
    });
    expect(() => loadGroundTruthManifest(p)).toThrow(/set 1 step 1.*not an image/);
  });
});
