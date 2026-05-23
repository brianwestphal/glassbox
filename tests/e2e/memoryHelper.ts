import type { Page } from '@playwright/test';

/**
 * Heap-stability helpers for Playwright tests. These cover the kind of
 * leak the Glassbox client is most exposed to — a `mount()` tree, a
 * `delegate()` listener, or a polling timer that isn't disposed when the
 * UI re-renders.
 *
 * The protocol: take a baseline `usedJSHeapSize` reading, run the
 * candidate interaction in a loop, force GC, then read again. Tiny
 * growth is expected (every interaction allocates *something* — strings,
 * promises, event objects) — what we care about is that growth doesn't
 * scale with the iteration count, which would mean references are being
 * retained per cycle.
 *
 * The Chromium heap measurement is approximate (V8 reports it lazily,
 * GC isn't guaranteed to reclaim everything in one pass), so the
 * thresholds are deliberately loose. The goal is to catch order-of-
 * magnitude leaks ("retains an entire DOM tree per switch"), not
 * tens-of-bytes drift.
 */

interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/**
 * Force the V8 GC via the Chrome DevTools Protocol, then read
 * `performance.memory.usedJSHeapSize`. Issues two GC passes because V8
 * sometimes leaves work for the next cycle, and a small idle delay so
 * any post-microtask cleanup can settle before we read the heap.
 */
export async function measureHeap(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('HeapProfiler.collectGarbage');
    await session.send('HeapProfiler.collectGarbage');
  } finally {
    await session.detach();
  }
  // Brief settle before reading — gives `requestIdleCallback`/microtask
  // queues a chance to drain.
  await page.waitForTimeout(50);
  return page.evaluate<number>(() => {
    const pm = (performance as Performance & { memory?: PerfMemory }).memory;
    return pm ? pm.usedJSHeapSize : 0;
  });
}

interface StabilityCheckOptions {
  /** Number of times to run `action` before re-measuring. */
  iterations: number;
  /** Discarded warm-up cycles before the baseline measurement; covers
   *  one-time allocations made on the first run that won't recur. */
  warmupCycles?: number;
  /** Per-iteration heap-growth budget in bytes. The total budget is
   *  `iterations * perIterationBytes`. */
  perIterationBytes: number;
  /** Hard floor in bytes — even if `perIterationBytes * iterations` is
   *  tiny, accept up to this much absolute growth (covers measurement
   *  noise from V8's lazy heap accounting). */
  absoluteFloorBytes?: number;
  /** Human label for the assertion message. */
  label: string;
}

/**
 * Run `action()` `iterations` times after `warmupCycles` warm-ups, and
 * assert that the heap delta is within budget. Throws an `Error` (with
 * before / after / delta numbers) on failure so the Playwright report
 * shows the actual usage rather than a generic timeout.
 */
export async function expectStableHeap(
  page: Page,
  action: () => Promise<void>,
  opts: StabilityCheckOptions,
): Promise<void> {
  const warmup = opts.warmupCycles ?? Math.min(2, opts.iterations);
  for (let i = 0; i < warmup; i++) await action();
  const before = await measureHeap(page);
  for (let i = 0; i < opts.iterations; i++) await action();
  const after = await measureHeap(page);

  const delta = after - before;
  const budget = Math.max(
    opts.absoluteFloorBytes ?? 0,
    opts.iterations * opts.perIterationBytes,
  );
  if (delta > budget) {
    const fmt = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
    throw new Error(
      `${opts.label}: heap grew ${fmt(delta)} over ${String(opts.iterations)} iteration(s), budget ${fmt(budget)} (before ${fmt(before)}, after ${fmt(after)})`,
    );
  }
}
