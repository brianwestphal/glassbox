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

  // GB-1085: EPERM from kill(pid, 0) means the process EXISTS (another user's)
  // — it must be treated as "held", not "stale" (the old code removed the lock).
  it('exits (does not steal the lock) when kill(pid, 0) throws EPERM', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 99999, startedAt: new Date().toISOString() }));

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const mockStderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockKill = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('EPERM') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });

    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);

    expect(mockExit).toHaveBeenCalledWith(1);
    // The other instance's lock survives.
    expect(JSON.parse(readFileSync(lockPath, 'utf-8'))).toMatchObject({ pid: 99999 });

    mockKill.mockRestore();
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

  // GB-1085 TOCTOU fix: the `wx` exclusive-create means that when two launches
  // race past the exists-check, the loser gets EEXIST and exits instead of
  // silently overwriting the winner's lock. Simulated by making existsSync say
  // "no lock" while a live-pid lock file actually sits on disk.
  it('exits when another instance wins the exclusive-create race (EEXIST)', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

    const realFs = await vi.importActual<typeof import('fs')>('fs');
    vi.doMock('fs', () => ({ ...realFs, existsSync: () => false }));

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const mockStderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('grabbed the lock first'));
    // The winner's lock survives untouched.
    expect(JSON.parse(readFileSync(lockPath, 'utf-8'))).toMatchObject({ pid: process.pid });

    vi.doUnmock('fs');
  });

  it('rethrows a non-EEXIST write failure instead of exiting quietly', async () => {
    const realFs = await vi.importActual<typeof import('fs')>('fs');
    vi.doMock('fs', () => ({
      ...realFs,
      existsSync: () => false,
      writeFileSync: () => {
        const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    }));

    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    expect(() => { acquireLock(testDir); }).toThrow('EACCES');

    vi.doUnmock('fs');
  });
});

describe('lock cleanup handlers', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `glassbox-test-lock-cleanup-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** Acquire the lock and return the listeners this acquisition registered,
   *  plus a disposer that removes them (they live on the process object). */
  async function acquireAndCapture() {
    const before = {
      exit: process.listeners('exit'),
      SIGINT: process.listeners('SIGINT'),
      SIGTERM: process.listeners('SIGTERM'),
    };
    vi.resetModules();
    const { acquireLock } = await import('../../../src/lock.js');
    acquireLock(testDir);
    const added = {
      exit: process.listeners('exit').filter((l) => !before.exit.includes(l)),
      SIGINT: process.listeners('SIGINT').filter((l) => !before.SIGINT.includes(l)),
      SIGTERM: process.listeners('SIGTERM').filter((l) => !before.SIGTERM.includes(l)),
    };
    const dispose = () => {
      for (const l of added.exit) process.removeListener('exit', l);
      for (const l of added.SIGINT) process.removeListener('SIGINT', l);
      for (const l of added.SIGTERM) process.removeListener('SIGTERM', l);
    };
    return { added, dispose };
  }

  it('registers exit, SIGINT, and SIGTERM cleanup handlers', async () => {
    const { added, dispose } = await acquireAndCapture();
    expect(added.exit).toHaveLength(1);
    expect(added.SIGINT).toHaveLength(1);
    expect(added.SIGTERM).toHaveLength(1);
    dispose();
  });

  it('exit handler removes the lock file and is idempotent on a second call', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    const { added, dispose } = await acquireAndCapture();
    expect(existsSync(lockPath)).toBe(true);

    (added.exit[0] as () => void)();
    expect(existsSync(lockPath)).toBe(false);

    // Second invocation (e.g. exit after SIGINT already cleaned up) is a no-op.
    expect(() => { (added.exit[0] as () => void)(); }).not.toThrow();
    dispose();
  });

  it('SIGINT handler releases the lock then exits 0', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    const { added, dispose } = await acquireAndCapture();
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    (added.SIGINT[0] as () => void)();
    expect(existsSync(lockPath)).toBe(false);
    expect(mockExit).toHaveBeenCalledWith(0);
    dispose();
  });

  it('SIGTERM handler releases the lock then exits 0', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    const { added, dispose } = await acquireAndCapture();
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    (added.SIGTERM[0] as () => void)();
    expect(existsSync(lockPath)).toBe(false);
    expect(mockExit).toHaveBeenCalledWith(0);
    dispose();
  });

  // Transition sequence: acquire → release (via handler) → re-acquire must
  // succeed like a fresh start, not trip over its own previous lock.
  it('can re-acquire after a released lock', async () => {
    const lockPath = join(testDir, 'glassbox.lock');
    const first = await acquireAndCapture();
    (first.added.exit[0] as () => void)();
    first.dispose();
    expect(existsSync(lockPath)).toBe(false);

    const second = await acquireAndCapture();
    expect(existsSync(lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, 'utf-8')).pid).toBe(process.pid);
    (second.added.exit[0] as () => void)();
    second.dispose();
  });
});
