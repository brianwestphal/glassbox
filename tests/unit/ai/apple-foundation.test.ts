import { generate, isPlatformSupported, probe } from 'apple-fm';

import {
  _resetAppleFoundationCache,
  isAppleFoundationAvailable,
  runAppleFoundationInfer,
} from '../../../src/ai/apple-foundation.js';

// The bridge now delegates to the `apple-fm` library; mock that boundary so the
// availability matrix and inference path are testable on any platform (the real
// on-device helper only runs on macOS-26 with Apple Intelligence).
vi.mock('apple-fm', () => ({
  isPlatformSupported: vi.fn(() => true),
  probe: vi.fn(async () => ({ available: true })),
  generate: vi.fn(async () => ''),
}));

const mockIsPlatformSupported = vi.mocked(isPlatformSupported);
const mockProbe = vi.mocked(probe);
const mockGenerate = vi.mocked(generate);

describe('apple-foundation bridge (doc 22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAppleFoundationCache();
    mockIsPlatformSupported.mockReturnValue(true);
    mockProbe.mockResolvedValue({ available: true });
  });

  describe('availability', () => {
    it('is false on an unsupported platform even when the probe would say available', async () => {
      mockIsPlatformSupported.mockReturnValue(false);
      mockProbe.mockResolvedValue({ available: true });
      expect(await isAppleFoundationAvailable()).toBe(false);
      // The probe must not even be attempted off-platform.
      expect(mockProbe).not.toHaveBeenCalled();
    });

    it('is true when the platform is supported and the probe reports available', async () => {
      mockProbe.mockResolvedValue({ available: true });
      expect(await isAppleFoundationAvailable()).toBe(true);
    });

    it('is false when the probe reports unavailable', async () => {
      mockProbe.mockResolvedValue({ available: false, reason: 'appleIntelligenceNotEnabled' });
      expect(await isAppleFoundationAvailable()).toBe(false);
    });

    it('is false when the probe throws (helper crash)', async () => {
      mockProbe.mockRejectedValue(new Error('spawn fail'));
      expect(await isAppleFoundationAvailable()).toBe(false);
    });

    it('caches the first probe result', async () => {
      mockProbe.mockResolvedValue({ available: true });
      await isAppleFoundationAvailable();
      await isAppleFoundationAvailable();
      expect(mockProbe).toHaveBeenCalledTimes(1);
    });

    // GB-1158: the NEGATIVE result is cached too (fail-then-never-recover). A
    // false/throwing probe sets `availabilityCache` to false, so a subsequent
    // call returns false WITHOUT re-probing — even if the platform would now
    // report available. Pinning this transition (the positive-cache test alone
    // left the negative branch of the cache unasserted).
    it('caches a false probe result and never re-probes (fail-then-never-recover)', async () => {
      mockProbe.mockResolvedValue({ available: false, reason: 'appleIntelligenceNotEnabled' });
      expect(await isAppleFoundationAvailable()).toBe(false);

      // A later probe would now say available — but the cache short-circuits it.
      mockProbe.mockResolvedValue({ available: true });
      expect(await isAppleFoundationAvailable()).toBe(false);
      expect(mockProbe).toHaveBeenCalledTimes(1);
    });

    it('caches a thrown probe as unavailable and never re-probes', async () => {
      mockProbe.mockRejectedValue(new Error('spawn fail'));
      expect(await isAppleFoundationAvailable()).toBe(false);

      mockProbe.mockResolvedValue({ available: true });
      expect(await isAppleFoundationAvailable()).toBe(false);
      expect(mockProbe).toHaveBeenCalledTimes(1);
    });
  });

  describe('inference', () => {
    it('sends {system, messages} to generate and returns the model content', async () => {
      mockGenerate.mockResolvedValue('[{"filePath":"a"}]');
      const out = await runAppleFoundationInfer('sys', [{ role: 'user', content: 'hi' }]);
      expect(out).toBe('[{"filePath":"a"}]');
      expect(mockGenerate).toHaveBeenCalledWith({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    });

    it('propagates a generation failure', async () => {
      mockGenerate.mockRejectedValue(new Error('helper not found'));
      await expect(runAppleFoundationInfer('s', [])).rejects.toThrow('helper not found');
    });
  });
});
