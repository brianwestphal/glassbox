/**
 * GB-891 — "Open in Default Editor" (sidebar context menu) shells out to the
 * user's editor. These tests pin the doc-14 FR-14.3 contract: the editor is
 * spawned with argv arrays, never a shell-interpolated string, and the file
 * path is always a separate trailing argument (so a path with spaces or shell
 * metacharacters is safe). They also cover `$VISUAL`/`$EDITOR` precedence and
 * the per-OS default-open fallback.
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
  // The test machine may have $EDITOR/$VISUAL set; clear them so the fallback
  // cases are deterministic.
  delete process.env.VISUAL;
  delete process.env.EDITOR;
});

afterEach(() => {
  spawnMock.mockClear();
  Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
});

describe("openOS(path, 'edit') (GB-891)", () => {
  it('spawns $VISUAL with embedded flags split into argv and the path appended separately', () => {
    process.env.VISUAL = 'code --wait';
    openOS('/repo/src/a b.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('code', ['--wait', '/repo/src/a b.ts'], { detached: true, stdio: 'ignore' });
  });

  it('prefers $VISUAL over $EDITOR', () => {
    process.env.VISUAL = 'subl';
    process.env.EDITOR = 'vim';
    openOS('/x.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('subl', ['/x.ts'], { detached: true, stdio: 'ignore' });
  });

  it('uses $EDITOR when $VISUAL is unset', () => {
    process.env.EDITOR = 'nano';
    openOS('/x.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('nano', ['/x.ts'], { detached: true, stdio: 'ignore' });
  });

  it('falls back to macOS `open` when no editor env is set', () => {
    setPlatform('darwin');
    openOS('/x.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('open', ['/x.ts'], { detached: true, stdio: 'ignore' });
  });

  it('falls back to `xdg-open` on Linux', () => {
    setPlatform('linux');
    openOS('/x.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('xdg-open', ['/x.ts'], { detached: true, stdio: 'ignore' });
  });

  it('falls back to `cmd /c start` on Windows', () => {
    setPlatform('win32');
    openOS('/x.ts', 'edit');
    expect(spawnMock).toHaveBeenCalledWith('cmd', ['/c', 'start', '', '/x.ts'], { detached: true, stdio: 'ignore' });
  });
});
