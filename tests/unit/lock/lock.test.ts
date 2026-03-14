import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('acquireLock', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `glassbox-test-lock-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('creates lock file when none exists', async () => {
    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);

    const lockPath = join(testDir, 'glassbox.lock');
    expect(existsSync(lockPath)).toBe(true);

    const contents = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(contents.pid).toBe(process.pid);
    expect(contents.startedAt).toBeDefined();
  });

  it('lock file contains valid JSON with pid and startedAt', async () => {
    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);

    const lockPath = join(testDir, 'glassbox.lock');
    const contents = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(typeof contents.pid).toBe('number');
    expect(contents.pid).toBe(process.pid);
    expect(typeof contents.startedAt).toBe('string');
    // startedAt should be a valid ISO date string
    expect(new Date(contents.startedAt).toISOString()).toBe(contents.startedAt);
  });

  it('removes stale lock from dead process', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    // PID 999999 is extremely unlikely to be alive
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));

    const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);

    const contents = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(contents.pid).toBe(process.pid);

    mockLog.mockRestore();
  });

  it('removes corrupt lock file and creates new lock', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    writeFileSync(lockPath, 'not json!!!');

    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);

    const contents = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(contents.pid).toBe(process.pid);
    expect(contents.startedAt).toBeDefined();
  });

  it('exits when lock held by live process', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    // Use current PID — it is guaranteed to be alive
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

    // Mock process.exit as a no-op (don't throw — the inner catch would swallow it)
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const mockStderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);

    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockStderr.mockRestore();
  });

  it('prints error messages when lock held by live process', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const mockStderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);

    // Should have printed PID and data directory info
    expect(mockStderr).toHaveBeenCalledWith(
      expect.stringContaining(`PID ${process.pid}`),
    );
    expect(mockStderr).toHaveBeenCalledWith(
      expect.stringContaining(testDir),
    );
  });
});
