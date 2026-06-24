/**
 * Unit tests for src/utils/openOS.ts covering the 'url', 'reveal', and
 * 'quicklook' modes across platforms (the 'edit' mode is covered in
 * openOS.test.ts). We mock child_process so nothing is actually launched and
 * assert the exact command + argv per platform — including the detached/
 * non-blocking spawn for reveal/quicklook vs the synchronous execFileSync for
 * url, and the best-effort error swallow on a failed detached launch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
const execFileSyncMock = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

const debugLogMock = vi.fn();
vi.mock('../../../src/debug.js', () => ({
  debugLog: (...args: unknown[]) => debugLogMock(...args),
}));

const { openOS } = await import('../../../src/utils/openOS.js');

const origPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
});

describe("openOS(target, 'url')", () => {
  it('uses execFileSync open on macOS (synchronous)', () => {
    setPlatform('darwin');
    openOS('https://example.com', 'url');
    expect(execFileSyncMock).toHaveBeenCalledWith('open', ['https://example.com']);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('routes through cmd /c start on Windows', () => {
    setPlatform('win32');
    openOS('https://example.com', 'url');
    expect(execFileSyncMock).toHaveBeenCalledWith('cmd', ['/c', 'start', '', 'https://example.com']);
  });

  it('uses xdg-open on Linux', () => {
    setPlatform('linux');
    openOS('https://example.com', 'url');
    expect(execFileSyncMock).toHaveBeenCalledWith('xdg-open', ['https://example.com']);
  });
});

describe("openOS(target, 'reveal')", () => {
  it('uses open -R (Finder) on macOS, detached', () => {
    setPlatform('darwin');
    openOS('/repo/src/a.ts', 'reveal');
    expect(spawnMock).toHaveBeenCalledWith('open', ['-R', '/repo/src/a.ts'], { detached: true, stdio: 'ignore' });
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('uses explorer /select,PATH on Windows', () => {
    setPlatform('win32');
    openOS('C:/repo/a.ts', 'reveal');
    expect(spawnMock).toHaveBeenCalledWith('explorer', ['/select,C:/repo/a.ts'], { detached: true, stdio: 'ignore' });
  });

  it('falls back to opening the parent directory via xdg-open on Linux', () => {
    setPlatform('linux');
    openOS('/repo/src/a.ts', 'reveal');
    expect(spawnMock).toHaveBeenCalledWith('xdg-open', ['/repo/src'], { detached: true, stdio: 'ignore' });
  });
});

describe("openOS(target, 'quicklook')", () => {
  it('uses qlmanage -p on macOS, detached', () => {
    setPlatform('darwin');
    openOS('/repo/img.png', 'quicklook');
    expect(spawnMock).toHaveBeenCalledWith('qlmanage', ['-p', '/repo/img.png'], { detached: true, stdio: 'ignore' });
  });

  it('falls back to cmd /c start on Windows', () => {
    setPlatform('win32');
    openOS('C:/img.png', 'quicklook');
    expect(spawnMock).toHaveBeenCalledWith('cmd', ['/c', 'start', '', 'C:/img.png'], { detached: true, stdio: 'ignore' });
  });

  it('falls back to xdg-open on Linux', () => {
    setPlatform('linux');
    openOS('/img.png', 'quicklook');
    expect(spawnMock).toHaveBeenCalledWith('xdg-open', ['/img.png'], { detached: true, stdio: 'ignore' });
  });
});

describe('detached launch error handling (best-effort)', () => {
  it('logs under debug and swallows a spawn error rather than throwing', () => {
    setPlatform('darwin');
    let errorHandler: ((err: Error) => void) | undefined;
    spawnMock.mockReturnValueOnce({
      on: (event: string, cb: (err: Error) => void) => { if (event === 'error') errorHandler = cb; },
      unref: vi.fn(),
    });

    expect(() => openOS('/repo/a.ts', 'reveal')).not.toThrow();
    // Simulate the async spawn failure the handler is registered for.
    errorHandler?.(new Error('command not found'));
    expect(debugLogMock).toHaveBeenCalledWith(expect.stringContaining('launchDetached(open) failed: command not found'));
  });
});
