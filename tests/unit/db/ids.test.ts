import { describe, expect, it } from 'vitest';

import { generateId } from '../../../src/db/ids.js';

describe('generateId', () => {
  it('produces the documented format: base36 ms timestamp + 8 random base36 chars', () => {
    const id = generateId();
    // Timestamp portion is variable length (base36 of Date.now()), followed by
    // exactly 8 random base36 chars. Total is timestamp length + 8.
    const tsLen = Date.now().toString(36).length;
    expect(id).toMatch(/^[0-9a-z]+$/);
    expect(id.length).toBe(tsLen + 8);
  });

  it('is highly likely to be unique across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(generateId());
    expect(ids.size).toBe(1000);
  });

  it('is roughly time-sortable: the timestamp prefix is monotonic across a delay', () => {
    const a = generateId();
    // Busy-wait ~2ms so Date.now() advances (avoids importing timers).
    const start = Date.now();
    while (Date.now() - start < 2) {
      /* spin */
    }
    const b = generateId();
    // Compare only the timestamp prefixes (strip the 8 random suffix chars).
    const aPrefix = a.slice(0, -8);
    const bPrefix = b.slice(0, -8);
    expect(bPrefix >= aPrefix).toBe(true);
  });
});
