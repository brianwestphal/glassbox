import { getKeychainLabel } from '../../../src/ai/config.js';

describe('getKeychainLabel', () => {
  it('returns Keychain on macOS', () => {
    // process.platform is read-only, so we just test the current platform
    const label = getKeychainLabel();
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
    // On macOS test runner:
    if (process.platform === 'darwin') {
      expect(label).toBe('Keychain');
    }
  });
});
