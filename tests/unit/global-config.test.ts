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
