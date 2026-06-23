import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { promoteGroundTruthBaselines } from '../../../src/ground-truth/promote.js';

// doc 26 §26.6 P3d — the optional baseline-rotation helper.
describe('promoteGroundTruthBaselines', () => {
  let dir: string;
  const write = (rel: string, bytes: string): string => {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, bytes);
    return p;
  };
  const manifest = (obj: unknown): string => {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gt-promote-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('copies a previous-actual entry actual over its baseline, creating the dir', () => {
    write('out/a.png', 'NEW-ACTUAL');
    const m = manifest({
      version: 1,
      comparisons: [{ actual: 'out/a.png', expected: 'baseline/a.png', expectedKind: 'previous-actual' }],
    });
    const res = promoteGroundTruthBaselines(m);
    expect(res.promoted).toHaveLength(1);
    expect(res.promoted[0].key).toBe('out/a.png');
    expect(existsSync(join(dir, 'baseline/a.png'))).toBe(true);
    expect(readFileSync(join(dir, 'baseline/a.png'), 'utf-8')).toBe('NEW-ACTUAL');
  });

  it('never overwrites a spec or reference expected (safety by construction)', () => {
    write('out/a.png', 'A');
    write('out/b.png', 'B');
    write('spec/a.png', 'SPEC');
    const m = manifest({
      version: 1,
      comparisons: [
        { actual: 'out/a.png', expected: 'spec/a.png', expectedKind: 'spec' },
        { actual: 'out/b.png', expected: 'ref/b.png', expectedKind: 'reference' },
      ],
    });
    const res = promoteGroundTruthBaselines(m);
    expect(res.promoted).toHaveLength(0);
    expect(res.skipped).toHaveLength(2);
    // The spec is untouched and no reference baseline was written.
    expect(readFileSync(join(dir, 'spec/a.png'), 'utf-8')).toBe('SPEC');
    expect(existsSync(join(dir, 'ref/b.png'))).toBe(false);
  });

  it('skips a previous-actual entry whose actual is missing', () => {
    const m = manifest({
      version: 1,
      comparisons: [{ actual: 'out/gone.png', expected: 'baseline/gone.png', expectedKind: 'previous-actual' }],
    });
    const res = promoteGroundTruthBaselines(m);
    expect(res.promoted).toHaveLength(0);
    expect(res.skipped[0].reason).toMatch(/actual image not found/);
    expect(existsSync(join(dir, 'baseline/gone.png'))).toBe(false);
  });

  it('promotes previous-actual steps inside a version: 2 set', () => {
    write('out/checkout/1.png', 'STEP1');
    write('out/checkout/2.png', 'STEP2');
    const m = manifest({
      version: 2,
      sets: [
        {
          label: 'Checkout',
          expectedKind: 'previous-actual',
          steps: [
            { actual: 'out/checkout/1.png', expected: 'baseline/checkout/1.png' },
            { actual: 'out/checkout/2.png', expected: 'baseline/checkout/2.png', expectedKind: 'spec' },
          ],
        },
      ],
    });
    const res = promoteGroundTruthBaselines(m);
    // Step 1 inherits previous-actual → promoted; step 2 overrides to spec → skipped.
    expect(res.promoted.map(p => p.key)).toEqual(['set:0/0-1.png']);
    expect(readFileSync(join(dir, 'baseline/checkout/1.png'), 'utf-8')).toBe('STEP1');
    expect(existsSync(join(dir, 'baseline/checkout/2.png'))).toBe(false);
  });
});
