/**
 * Unit tests for src/git/difftool-client.ts — the thin-client side of the
 * accumulating `git difftool` model (doc 19). The module is side-effecting glue
 * (spawn detached servers, loopback HTTP), so we mock `node:child_process`, the
 * discovery helpers, and `fetch` to exercise the arg construction and the
 * discover/append/hold decisions without launching anything real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

const spawnMock = vi.fn(() => ({ unref: vi.fn() }));
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const readDiscoveryMock = vi.fn<() => { port: number; pid?: number } | null>();
const tryAcquireStartingLockMock = vi.fn<() => boolean>();
vi.mock('../../../src/git/difftool-discovery.js', () => ({
  readDiscovery: () => readDiscoveryMock(),
  tryAcquireStartingLock: () => tryAcquireStartingLockMock(),
}));

const {
  spawnDetachedBrowserServer,
  launchDetachedDesktopSession,
  discoverOrStartServer,
  appendFile,
  holdUntilEnd,
} = await import('../../../src/git/difftool-client.js');

// --- Helpers ---

const origPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
});

describe('spawnDetachedBrowserServer', () => {
  it('spawns the CLI with --difftool-serve detached and unref\'s it', () => {
    const unref = vi.fn();
    spawnMock.mockReturnValueOnce({ unref });

    spawnDetachedBrowserServer('/path/cli.js', '/work/dir');

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      ['/path/cli.js', '--difftool-serve'],
      { cwd: '/work/dir', detached: true, stdio: 'ignore' },
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });
});

describe('launchDetachedDesktopSession', () => {
  it('runs the launcher through a shell on Windows', () => {
    setPlatform('win32');
    const unref = vi.fn();
    spawnMock.mockReturnValueOnce({ unref });

    launchDetachedDesktopSession('C:/Glassbox/launch.cmd', '/work');

    expect(spawnMock).toHaveBeenCalledWith(
      '"C:/Glassbox/launch.cmd" --difftool-serve',
      { cwd: '/work', detached: true, stdio: 'ignore', shell: true },
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('spawns the launcher with an argv array on non-Windows', () => {
    setPlatform('darwin');
    const unref = vi.fn();
    spawnMock.mockReturnValueOnce({ unref });

    launchDetachedDesktopSession('/Applications/Glassbox/launcher', '/work');

    expect(spawnMock).toHaveBeenCalledWith(
      '/Applications/Glassbox/launcher',
      ['--difftool-serve'],
      { cwd: '/work', detached: true, stdio: 'ignore' },
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });
});

describe('discoverOrStartServer', () => {
  it('returns the port of an already-running server that pings active', async () => {
    readDiscoveryMock.mockReturnValue({ port: 4321 });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ active: true }) });
    const startServer = vi.fn();

    const port = await discoverOrStartServer(startServer);

    expect(port).toBe(4321);
    expect(startServer).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4321/api/difftool/ping',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('starts a server (winning the lock) when none is discovered, then returns its port', async () => {
    // First loop: no discovery → wins lock → startServer().
    // Second loop: discovery present and pings active.
    readDiscoveryMock
      .mockReturnValueOnce(null)
      .mockReturnValue({ port: 5000 });
    tryAcquireStartingLockMock.mockReturnValue(true);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ active: true }) });
    const startServer = vi.fn();

    const port = await discoverOrStartServer(startServer, 5000);

    expect(port).toBe(5000);
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it('does not start a server when it loses the start-lock election', async () => {
    // No discovery on the first probe (loses lock), then a peer's server appears.
    readDiscoveryMock
      .mockReturnValueOnce(null)
      .mockReturnValue({ port: 6000 });
    tryAcquireStartingLockMock.mockReturnValue(false);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ active: true }) });
    const startServer = vi.fn();

    const port = await discoverOrStartServer(startServer, 5000);

    expect(port).toBe(6000);
    expect(startServer).not.toHaveBeenCalled();
  });

  it('treats a non-ok ping as no live server', async () => {
    readDiscoveryMock
      .mockReturnValueOnce({ port: 7000 }) // exists but ping fails
      .mockReturnValue({ port: 7000 });
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => ({ active: true }) });
    tryAcquireStartingLockMock.mockReturnValue(true);
    const startServer = vi.fn();

    const port = await discoverOrStartServer(startServer, 5000);

    expect(port).toBe(7000);
    // It had to start one because the first ping wasn't a live session.
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it('treats active:false as not-a-live-session', async () => {
    readDiscoveryMock
      .mockReturnValueOnce({ port: 8000 })
      .mockReturnValue({ port: 8000 });
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ active: false }) })
      .mockResolvedValue({ ok: true, json: async () => ({ active: true }) });
    tryAcquireStartingLockMock.mockReturnValue(true);
    const startServer = vi.fn();

    const port = await discoverOrStartServer(startServer, 5000);
    expect(port).toBe(8000);
  });

  it('treats a thrown fetch (server refused) as no live server', async () => {
    readDiscoveryMock
      .mockReturnValueOnce({ port: 9000 })
      .mockReturnValue({ port: 9000 });
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true, json: async () => ({ active: true }) });
    tryAcquireStartingLockMock.mockReturnValue(true);
    const startServer = vi.fn();

    const port = await discoverOrStartServer(startServer, 5000);
    expect(port).toBe(9000);
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  it('throws when no server becomes ready before the deadline', async () => {
    readDiscoveryMock.mockReturnValue(null);
    tryAcquireStartingLockMock.mockReturnValue(false);
    const startServer = vi.fn();

    // A tiny timeout forces the loop to expire promptly.
    await expect(discoverOrStartServer(startServer, 1)).rejects.toThrow(/timed out/);
  });
});

describe('appendFile', () => {
  it('POSTs base64 old/new content and resolves on a 2xx', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    await appendFile(4183, 'src/a.ts', Buffer.from('old'), Buffer.from('new'));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4183/api/difftool/append',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.path).toBe('src/a.ts');
    expect(Buffer.from(body.oldContentB64, 'base64').toString()).toBe('old');
    expect(Buffer.from(body.newContentB64, 'base64').toString()).toBe('new');
  });

  it('throws with the status and response detail on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    await expect(
      appendFile(4183, 'x', Buffer.alloc(0), Buffer.alloc(0)),
    ).rejects.toThrow(/append failed \(500\) boom/);
  });

  it('still throws when reading the error body itself fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => { throw new Error('no body'); },
    });

    await expect(
      appendFile(4183, 'x', Buffer.alloc(0), Buffer.alloc(0)),
    ).rejects.toThrow(/append failed \(503\)/);
  });
});

describe('holdUntilEnd', () => {
  it('awaits the hold endpoint and resolves when the server responds', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await expect(holdUntilEnd(4183)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4183/api/difftool/hold');
  });

  it('swallows a dropped connection (the server closing is the end signal)', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    await expect(holdUntilEnd(4183)).resolves.toBeUndefined();
  });
});
