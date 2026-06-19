import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GLOBAL_CONFIG_PATH, readGlobalConfig, updateGlobalConfig } from '../../src/global-config.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  };
});

describe('global-config', () => {
  let fsMock: typeof import('fs');

  beforeEach(async () => {
    fsMock = await import('fs');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('readGlobalConfig', () => {
    it('returns empty object when file does not exist', () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      expect(readGlobalConfig()).toEqual({});
    });

    it('returns parsed JSON when file exists and is valid', () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockReturnValue('{"channelEnabled":true,"theme":{"active":"dark"}}');
      expect(readGlobalConfig()).toEqual({ channelEnabled: true, theme: { active: 'dark' } });
    });

    it('returns empty object when JSON is malformed', () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockReturnValue('not json');
      expect(readGlobalConfig()).toEqual({});
    });

    it('returns empty object when JSON is an array (defensive)', () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockReturnValue('[1,2,3]');
      expect(readGlobalConfig()).toEqual({});
    });
  });

  describe('GLASSBOX_CONFIG_DIR override (GB-923)', () => {
    // The dir is resolved once at import, so each case sets the env then
    // re-imports the module fresh via vi.resetModules() + dynamic import.
    const saved = process.env.GLASSBOX_CONFIG_DIR;
    afterEach(() => {
      if (saved === undefined) delete process.env.GLASSBOX_CONFIG_DIR;
      else process.env.GLASSBOX_CONFIG_DIR = saved;
    });

    it('defaults to ~/.glassbox/config.json when the override is unset', async () => {
      delete process.env.GLASSBOX_CONFIG_DIR;
      vi.resetModules();
      const { homedir } = await import('os');
      const { join } = await import('path');
      const mod = await import('../../src/global-config.js');
      expect(mod.GLOBAL_CONFIG_DIR).toBe(join(homedir(), '.glassbox'));
      expect(mod.GLOBAL_CONFIG_PATH).toBe(join(homedir(), '.glassbox', 'config.json'));
    });

    it('uses GLASSBOX_CONFIG_DIR when set, so a test run never touches the real config', async () => {
      process.env.GLASSBOX_CONFIG_DIR = '/tmp/glassbox-e2e-config-123';
      vi.resetModules();
      const mod = await import('../../src/global-config.js');
      expect(mod.GLOBAL_CONFIG_DIR).toBe('/tmp/glassbox-e2e-config-123');
      expect(mod.GLOBAL_CONFIG_PATH).toBe('/tmp/glassbox-e2e-config-123/config.json');
    });

    it('ignores a blank override', async () => {
      process.env.GLASSBOX_CONFIG_DIR = '   ';
      vi.resetModules();
      const { homedir } = await import('os');
      const { join } = await import('path');
      const mod = await import('../../src/global-config.js');
      expect(mod.GLOBAL_CONFIG_DIR).toBe(join(homedir(), '.glassbox'));
    });
  });

  describe('updateGlobalConfig', () => {
    it('reads, mutates in place, then writes — no races between unrelated keys', () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockReturnValue('{"channelEnabled":true,"sharePrompt":{"totalOpenMs":100}}');

      updateGlobalConfig((cfg) => {
        const sp = cfg.sharePrompt as Record<string, unknown>;
        sp.totalOpenMs = 250;
      });

      expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
      const writeCall = vi.mocked(fsMock.writeFileSync).mock.calls[0];
      expect(writeCall[0]).toBe(GLOBAL_CONFIG_PATH);
      const written = JSON.parse(writeCall[1] as string);
      // Critical: unrelated key (channelEnabled) is preserved.
      expect(written.channelEnabled).toBe(true);
      expect(written.sharePrompt.totalOpenMs).toBe(250);
    });

    it('chmods the config to 0600 after writing', () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      updateGlobalConfig((cfg) => { cfg.x = 1; });
      expect(fsMock.chmodSync).toHaveBeenCalledWith(GLOBAL_CONFIG_PATH, 0o600);
    });

    it('replaces config when mutator returns a new object', () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);
      vi.mocked(fsMock.readFileSync).mockReturnValue('{"a":1}');
      updateGlobalConfig(() => ({ b: 2 }));
      const writeCall = vi.mocked(fsMock.writeFileSync).mock.calls[0];
      expect(JSON.parse(writeCall[1] as string)).toEqual({ b: 2 });
    });
  });
});
