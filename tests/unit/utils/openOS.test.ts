/**
 * GB-892 — "Open in Default Editor" (sidebar context menu) appeared to do
 * nothing. Root cause: it honored `$EDITOR`/`$VISUAL`, which are usually
 * *terminal* editors (e.g. `nano`/`vim`); spawned detached with no controlling
 * terminal they silently no-op. The fix routes the file through the OS
 * "open with the default GUI application" handler instead — and explicitly
 * IGNORES `$EDITOR`/`$VISUAL`, which these tests lock in so the broken behavior
 * can't regress. The path is always a separate argv (doc 14 FR-14.3), so a path
 * with spaces or shell metacharacters is safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFileSync: vi.fn(),
}));

const { openOS } = await import('../../../src/utils/openOS.js');

const origPlatform = process.platform;
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

beforeEach(() => {
  // A terminal editor in the env must NOT change behavior — set both to prove
  // the fix ignores them (this is exactly what caused the GB-892 no-op).
  process.env.EDITOR = 'nano -w';
  process.env.VISUAL = 'vim';
});

afterEach(() => {
  spawnMock.mockClear();
  delete process.env.EDITOR;
  delete process.env.VISUAL;
  Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
});

describe("openOS(path, 'edit') (GB-892)", () => {
  it('opens via macOS `open` with the path as a separate argv, ignoring $EDITOR/$VISUAL', () => {
    setPlatform('darwin');
    openOS('/repo/src/a b.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('open', ['/repo/src/a b.ts'], { detached: true, stdio: 'ignore' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('opens via `xdg-open` on Linux, ignoring $EDITOR/$VISUAL', () => {
    setPlatform('linux');
    openOS('/x.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('xdg-open', ['/x.ts'], { detached: true, stdio: 'ignore' });
  });

  it('opens via `cmd /c start` on Windows, ignoring $EDITOR/$VISUAL', () => {
    setPlatform('win32');
    openOS('/x.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('cmd', ['/c', 'start', '', '/x.ts'], { detached: true, stdio: 'ignore' });
  });

  it('never spawns the terminal editor named in $EDITOR/$VISUAL', () => {
    setPlatform('darwin');
    openOS('/x.ts', 'edit');
    const commands = spawnMock.mock.calls.map(call => (call as unknown[])[0]);
    expect(commands).not.toContain('nano');
    expect(commands).not.toContain('vim');
  });
});
