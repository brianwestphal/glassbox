import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/export/generate.js', () => ({
  generateReviewExport: vi.fn().mockResolvedValue('/fake/path'),
}));

import { generateReviewExport } from '../../../src/export/generate.js';
import { scheduleAutoExport, flushAutoExport } from '../../../src/export/auto-export.js';

const mockGenerate = vi.mocked(generateReviewExport);

describe('scheduleAutoExport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGenerate.mockClear();
  });

  afterEach(() => {
    // Flush any pending timers so they don't leak between tests
    vi.runAllTimers();
    vi.useRealTimers();
    mockGenerate.mockClear();
  });

  it('calls generateReviewExport after debounce delay', () => {
    scheduleAutoExport('review-1', '/repo');

    expect(mockGenerate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    expect(mockGenerate).toHaveBeenCalledOnce();
    expect(mockGenerate).toHaveBeenCalledWith('review-1', '/repo', true);
  });

  it('debounces multiple calls into one export', () => {
    scheduleAutoExport('review-1', '/repo');
    vi.advanceTimersByTime(500);
    scheduleAutoExport('review-1', '/repo');
    vi.advanceTimersByTime(500);
    scheduleAutoExport('review-1', '/repo');

    // Not yet fired
    expect(mockGenerate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    // Only one call despite three scheduleAutoExport invocations
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it('uses the latest arguments when debouncing', () => {
    scheduleAutoExport('review-1', '/repo-a');
    vi.advanceTimersByTime(500);
    scheduleAutoExport('review-2', '/repo-b');

    vi.advanceTimersByTime(2000);

    // Should use the most recent arguments since there's a single timer
    expect(mockGenerate).toHaveBeenCalledOnce();
    expect(mockGenerate).toHaveBeenCalledWith('review-2', '/repo-b', true);
  });

  it('fires immediately when debounce period elapses without interruption', () => {
    scheduleAutoExport('review-1', '/repo');

    vi.advanceTimersByTime(1999);
    expect(mockGenerate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockGenerate).toHaveBeenCalledOnce();
  });
});

describe('flushAutoExport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGenerate.mockClear();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    mockGenerate.mockClear();
  });

  it('immediately triggers pending export', () => {
    scheduleAutoExport('review-1', '/repo');
    expect(mockGenerate).not.toHaveBeenCalled();

    flushAutoExport('review-1', '/repo');
    expect(mockGenerate).toHaveBeenCalledOnce();
    expect(mockGenerate).toHaveBeenCalledWith('review-1', '/repo', true);
  });

  it('does not trigger export when no pending timer', () => {
    flushAutoExport('review-1', '/repo');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('cancels the debounced timer so it does not fire again', () => {
    scheduleAutoExport('review-1', '/repo');
    flushAutoExport('review-1', '/repo');

    mockGenerate.mockClear();

    // Advance past the debounce period — should not fire again
    vi.advanceTimersByTime(5000);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
