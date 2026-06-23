import { describe, expect, it } from 'vitest';

import type { GroundTruthMeta } from '../../../src/api/files.js';
import type { ReviewFile } from '../../../src/client/state.js';
import {
  buildGroundTruthSourceList,
  groundTruthFileOrder,
} from '../../../src/client/sidebar/groundTruthGroups.js';

// doc 26 §26.3 P3b — source-list grouping of singles + version: 2 sets.
describe('buildGroundTruthSourceList', () => {
  const file = (id: string, path: string, score: number | null): ReviewFile => ({
    id,
    review_id: 'r1',
    file_path: path,
    status: 'pending',
    diff_data: null,
    difference_score: score,
    created_at: '',
  });

  const metaMap = (m: Record<string, GroundTruthMeta>) => (id: string) => m[id];

  it('renders a single as a single item carrying its own score', () => {
    const files = [file('a', 'a.png', 0.4)];
    const items = buildGroundTruthSourceList(files, metaMap({ a: {} }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'single', score: 0.4 });
  });

  it('groups set steps in declared order with a max aggregate', () => {
    const files = [
      file('s0', 'set:0/0-cart.png', 0.1),
      file('s1', 'set:0/1-pay.png', 0.6),
    ];
    const meta = metaMap({
      s0: { setIndex: 0, setLabel: 'Checkout', stepIndex: 0, stepCount: 2 },
      s1: { setIndex: 0, setLabel: 'Checkout', stepIndex: 1, stepCount: 2 },
    });
    const items = buildGroundTruthSourceList(files, meta);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'set', setIndex: 0, label: 'Checkout', aggregate: 0.6 });
    expect((items[0] as { steps: ReviewFile[] }).steps.map(s => s.id)).toEqual(['s0', 's1']);
  });

  it('orders set steps by stepIndex even when the files arrive out of order', () => {
    const files = [
      file('s1', 'set:0/1-pay.png', 0.2),
      file('s0', 'set:0/0-cart.png', 0.3),
    ];
    const meta = metaMap({
      s0: { setIndex: 0, setLabel: 'Checkout', stepIndex: 0, stepCount: 2 },
      s1: { setIndex: 0, setLabel: 'Checkout', stepIndex: 1, stepCount: 2 },
    });
    const items = buildGroundTruthSourceList(files, meta);
    expect((items[0] as { steps: ReviewFile[] }).steps.map(s => s.id)).toEqual(['s0', 's1']);
  });

  it('sorts singles and sets together most-different-first (set by aggregate)', () => {
    const files = [
      file('lo', 'low.png', 0.2),
      file('hi', 'high.png', 0.9),
      file('s0', 'set:0/0-a.png', 0.1),
      file('s1', 'set:0/1-b.png', 0.5),
    ];
    const meta = metaMap({
      lo: {},
      hi: {},
      s0: { setIndex: 0, setLabel: 'Flow', stepIndex: 0, stepCount: 2 },
      s1: { setIndex: 0, setLabel: 'Flow', stepIndex: 1, stepCount: 2 },
    });
    const items = buildGroundTruthSourceList(files, meta);
    // hi (0.9) > set Flow (agg 0.5) > lo (0.2)
    expect(items.map(i => (i.type === 'single' ? i.file.id : `set:${String(i.setIndex)}`))).toEqual([
      'hi',
      'set:0',
      'lo',
    ]);
  });

  it('falls back to the first step basename when a set has no label', () => {
    const files = [file('s0', 'set:0/0-home.png', 0.3)];
    const meta = metaMap({ s0: { setIndex: 0, stepIndex: 0, stepCount: 1 } });
    const items = buildGroundTruthSourceList(files, meta);
    expect(items[0]).toMatchObject({ type: 'set', label: 'set:0/0-home.png'.split('/').pop() });
  });

  it('flattens to a nav order with set steps consecutive', () => {
    const files = [
      file('hi', 'high.png', 0.9),
      file('s0', 'set:0/0-a.png', 0.1),
      file('s1', 'set:0/1-b.png', 0.5),
    ];
    const meta = metaMap({
      hi: {},
      s0: { setIndex: 0, setLabel: 'Flow', stepIndex: 0, stepCount: 2 },
      s1: { setIndex: 0, setLabel: 'Flow', stepIndex: 1, stepCount: 2 },
    });
    const order = groundTruthFileOrder(buildGroundTruthSourceList(files, meta));
    expect(order).toEqual(['hi', 's0', 's1']);
  });
});
