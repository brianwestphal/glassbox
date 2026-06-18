import {
  _resetAppleFoundationForTesting,
  _setAppleFoundationForTesting,
  isAppleFoundationAvailable,
  runAppleFoundationInfer,
} from '../../../src/ai/apple-foundation.js';

// An existing file so `appleFmBinPath()`'s existsSync check passes; the injected
// runner is what actually decides probe/infer behavior, not this binary.
const EXISTING_BIN = process.execPath;

describe('apple-foundation bridge (doc 22)', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.GLASSBOX_APPLE_FM_BIN;
    process.env.GLASSBOX_APPLE_FM_BIN = EXISTING_BIN;
  });

  afterEach(() => {
    _resetAppleFoundationForTesting();
    if (savedEnv === undefined) delete process.env.GLASSBOX_APPLE_FM_BIN;
    else process.env.GLASSBOX_APPLE_FM_BIN = savedEnv;
  });

  describe('availability', () => {
    it('is false on non-darwin even when the probe would say available', async () => {
      _setAppleFoundationForTesting({ darwin: false, runner: () => Promise.resolve({ stdout: 'available', code: 0 }) });
      expect(await isAppleFoundationAvailable()).toBe(false);
    });

    it('is true on darwin when the probe reports available', async () => {
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.resolve({ stdout: 'available\n', code: 0 }) });
      expect(await isAppleFoundationAvailable()).toBe(true);
    });

    it('is false when the probe reports unavailable', async () => {
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.resolve({ stdout: 'unavailable', code: 0 }) });
      expect(await isAppleFoundationAvailable()).toBe(false);
    });

    it('is false when the probe exits non-zero', async () => {
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.resolve({ stdout: 'available', code: 1 }) });
      expect(await isAppleFoundationAvailable()).toBe(false);
    });

    it('is false when the runner throws (helper crash)', async () => {
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.reject(new Error('spawn fail')) });
      expect(await isAppleFoundationAvailable()).toBe(false);
    });

    it('caches the first probe result', async () => {
      const runner = vi.fn(() => Promise.resolve({ stdout: 'available', code: 0 }));
      _setAppleFoundationForTesting({ darwin: true, runner });
      await isAppleFoundationAvailable();
      await isAppleFoundationAvailable();
      expect(runner).toHaveBeenCalledTimes(1);
    });

    it('is false when the helper binary is absent', async () => {
      delete process.env.GLASSBOX_APPLE_FM_BIN; // and no ./apple-fm-helper in cwd
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.resolve({ stdout: 'available', code: 0 }) });
      expect(await isAppleFoundationAvailable()).toBe(false);
    });
  });

  describe('inference', () => {
    it('sends {system, messages} and returns the model content', async () => {
      _setAppleFoundationForTesting({
        darwin: true,
        runner: (_bin, args, stdin) => {
          expect(args).toEqual(['--infer']);
          const parsed = JSON.parse(stdin) as { system: string; messages: { role: string; content: string }[] };
          expect(parsed.system).toBe('sys');
          expect(parsed.messages[0].content).toBe('hi');
          return Promise.resolve({ stdout: JSON.stringify({ content: '[{"filePath":"a"}]' }), code: 0 });
        },
      });
      const out = await runAppleFoundationInfer('sys', [{ role: 'user', content: 'hi' }]);
      expect(out).toBe('[{"filePath":"a"}]');
    });

    it('throws when the helper exits non-zero', async () => {
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.resolve({ stdout: '', code: 4 }) });
      await expect(runAppleFoundationInfer('s', [])).rejects.toThrow('exited with code 4');
    });

    it('throws on non-JSON output', async () => {
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.resolve({ stdout: 'not json', code: 0 }) });
      await expect(runAppleFoundationInfer('s', [])).rejects.toThrow('non-JSON');
    });

    it('throws on an unexpected payload shape', async () => {
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.resolve({ stdout: '{"wrong":1}', code: 0 }) });
      await expect(runAppleFoundationInfer('s', [])).rejects.toThrow('unexpected payload');
    });

    it('throws when the helper binary is absent', async () => {
      delete process.env.GLASSBOX_APPLE_FM_BIN;
      _setAppleFoundationForTesting({ darwin: true, runner: () => Promise.resolve({ stdout: '{}', code: 0 }) });
      await expect(runAppleFoundationInfer('s', [])).rejects.toThrow('helper not found');
    });
  });
});
