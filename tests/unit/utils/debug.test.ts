import { setDebug, isDebug, debugLog, setAIServiceTest, isAIServiceTest, setDemoMode, getDemoMode } from '../../../src/debug.js';

describe('debug module', () => {
  afterEach(() => {
    setDebug(false);
    setAIServiceTest(false);
    setDemoMode(null);
  });

  describe('debug flag', () => {
    it('defaults to false', () => {
      expect(isDebug()).toBe(false);
    });

    it('can be toggled on', () => {
      setDebug(true);
      expect(isDebug()).toBe(true);
    });

    it('can be toggled off', () => {
      setDebug(true);
      setDebug(false);
      expect(isDebug()).toBe(false);
    });
  });

  describe('AI service test flag', () => {
    it('defaults to false', () => {
      expect(isAIServiceTest()).toBe(false);
    });

    it('can be toggled on', () => {
      setAIServiceTest(true);
      expect(isAIServiceTest()).toBe(true);
    });
  });

  describe('demo mode', () => {
    it('defaults to null', () => {
      expect(getDemoMode()).toBeNull();
    });

    it('can be set to a scenario number', () => {
      setDemoMode(1);
      expect(getDemoMode()).toBe(1);
    });

    it('can be reset to null', () => {
      setDemoMode(2);
      setDemoMode(null);
      expect(getDemoMode()).toBeNull();
    });
  });

  describe('debugLog', () => {
    it('does not log when debug is disabled', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      debugLog('test message');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('logs with [debug] prefix when enabled', () => {
      setDebug(true);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      debugLog('test message');
      expect(spy).toHaveBeenCalledWith('[debug]', 'test message');
      spy.mockRestore();
    });
  });
});
