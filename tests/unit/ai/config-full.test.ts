import type { SpawnSyncReturns } from 'child_process';

import type { AIPlatform } from '../../../src/ai/models.js';

// --- Mocks ---

const fsMocks = {
  existsSync: vi.fn<(path: string) => boolean>(),
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  writeFileSync: vi.fn<(path: string, data: string, encoding: string) => void>(),
  mkdirSync: vi.fn<(path: string, opts: object) => void>(),
  chmodSync: vi.fn<(path: string, mode: number) => void>(),
};

vi.mock('fs', () => fsMocks);

const spawnSyncMock = vi.fn<(...args: unknown[]) => Partial<SpawnSyncReturns<string>>>();

vi.mock('child_process', () => ({
  spawnSync: spawnSyncMock,
}));

// Import after mocks are set up
const {
  resolveAPIKey,
  loadAIConfig,
  loadFallbackSelection,
  resolveLocalEndpoint,
  saveAIConfigPreferences,
  saveAPIKey,
  deleteAPIKey,
  detectAvailablePlatforms,
  isKeychainAvailable,
  loadGuidedReviewConfig,
  saveGuidedReviewConfig,
} = await import('../../../src/ai/config.js');

// --- Helpers ---

const savedEnv: Record<string, string | undefined> = {};
const envKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];

function setConfigFile(config: Record<string, unknown>): void {
  fsMocks.existsSync.mockReturnValue(true);
  fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));
}

function setNoConfigFile(): void {
  fsMocks.existsSync.mockReturnValue(false);
}

function clearEnvKeys(): void {
  for (const key of envKeys) {
    delete process.env[key];
  }
}

function setSpawnResult(stdout: string, status: number): void {
  spawnSyncMock.mockReturnValue({ stdout, status });
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
  }
  clearEnvKeys();
  setNoConfigFile();
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

describe('resolveAPIKey', () => {
  it('returns env key with source "env" when env var is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env-key';

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: 'sk-env-key', source: 'env' });
  });

  it('returns env key for openai platform', () => {
    process.env.OPENAI_API_KEY = 'sk-openai-key';

    const result = resolveAPIKey('openai');

    expect(result).toEqual({ key: 'sk-openai-key', source: 'env' });
  });

  it('returns env key for google platform', () => {
    process.env.GEMINI_API_KEY = 'gemini-key';

    const result = resolveAPIKey('google');

    expect(result).toEqual({ key: 'gemini-key', source: 'env' });
  });

  it('env var takes priority over keychain', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    setSpawnResult('sk-keychain', 0);

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: 'sk-env', source: 'env' });
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('falls back to keychain when env is not set (darwin)', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('sk-keychain-key', 0);

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: 'sk-keychain-key', source: 'keychain' });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'security',
      ['find-generic-password', '-s', 'glassbox', '-a', 'anthropic-api-key', '-w'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('falls back to keychain when env is not set (linux)', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    setSpawnResult('sk-linux-key', 0);

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: 'sk-linux-key', source: 'keychain' });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'secret-tool',
      ['lookup', 'service', 'glassbox', 'account', 'anthropic-api-key'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('falls back to keychain when env is not set (win32)', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    setSpawnResult('sk-win-key', 0);

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: 'sk-win-key', source: 'keychain' });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'powershell',
      ['-NoProfile', '-Command', '-'],
      expect.objectContaining({ encoding: 'utf-8', input: expect.stringContaining('glassbox-anthropic-api-key') }),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns null from keychain when spawnSync returns non-zero status', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);

    const result = resolveAPIKey('anthropic');

    // Falls through to config (no config either), so null
    expect(result).toEqual({ key: null, source: null });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns null from keychain when spawnSync returns empty stdout', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 0);

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: null, source: null });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns null from keychain when stdout is only whitespace', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('  \n  ', 0);

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: null, source: null });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('falls back to config file when keychain returns nothing', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);

    const encoded = Buffer.from('sk-config-key').toString('base64');
    setConfigFile({ ai: { keys: { anthropic: encoded } } });

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: 'sk-config-key', source: 'config' });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns null when no key found anywhere', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: null, source: null });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns null from config when key is empty string', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);
    setConfigFile({ ai: { keys: { anthropic: '' } } });

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: null, source: null });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('handles keychain spawnSync throwing an exception', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    spawnSyncMock.mockImplementation(() => { throw new Error('spawn failed'); });

    const result = resolveAPIKey('anthropic');

    // keychain catch block returns null, then falls to config (no config), so null
    expect(result).toEqual({ key: null, source: null });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('handles unsupported platform in keychain lookup', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'freebsd' });

    const result = resolveAPIKey('anthropic');

    // No keychain on freebsd, falls through to config
    expect(result).toEqual({ key: null, source: null });
    expect(spawnSyncMock).not.toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('handles corrupt config file gracefully', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue('not valid json{{{');

    const result = resolveAPIKey('anthropic');

    expect(result).toEqual({ key: null, source: null });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });
});

describe('loadAIConfig', () => {
  it('returns defaults when no config file exists', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);

    const config = loadAIConfig();

    expect(config.platform).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.apiKey).toBeNull();
    expect(config.keySource).toBeNull();

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('reads platform and model from config file', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);
    setConfigFile({ ai: { platform: 'openai', model: 'gpt-4o-mini' } });

    const config = loadAIConfig();

    expect(config.platform).toBe('openai');
    expect(config.model).toBe('gpt-4o-mini');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('resolves API key from env var', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-from-env';

    const config = loadAIConfig();

    expect(config.apiKey).toBe('sk-from-env');
    expect(config.keySource).toBe('env');
  });

  it('resolves API key from config file', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);

    const encoded = Buffer.from('sk-config-api-key').toString('base64');
    setConfigFile({ ai: { platform: 'anthropic', keys: { anthropic: encoded } } });

    const config = loadAIConfig();

    expect(config.apiKey).toBe('sk-config-api-key');
    expect(config.keySource).toBe('config');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('uses default model for the configured platform when model is missing', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);
    setConfigFile({ ai: { platform: 'google' } });

    const config = loadAIConfig();

    expect(config.platform).toBe('google');
    expect(config.model).toBe('gemini-2.5-flash');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('keeps `apple` as the platform when Apple FM analysis is enabled', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);
    setConfigFile({ ai: { platform: 'apple', model: 'apple-on-device' } });

    const config = loadAIConfig();

    expect(config.platform).toBe('apple');
    expect(config.fallback).toBeUndefined();

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('resolves the Apple-FM fallback config when one is saved', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);
    setConfigFile({ ai: { platform: 'apple', model: 'apple-on-device', fallbackPlatform: 'anthropic', fallbackModel: 'claude-sonnet-4-6' } });

    const config = loadAIConfig();

    expect(config.platform).toBe('apple');
    expect(config.fallback?.platform).toBe('anthropic');
    expect(config.fallback?.model).toBe('claude-sonnet-4-6');
    // One level only — the fallback has no fallback of its own.
    expect(config.fallback?.fallback).toBeUndefined();

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('ignores an `apple` fallback selection (can’t fall back to itself)', () => {
    setConfigFile({ ai: { platform: 'apple', fallbackPlatform: 'apple' } });
    expect(loadAIConfig().fallback).toBeUndefined();
  });

  it('does not attach a fallback when the primary platform is not apple', () => {
    setConfigFile({ ai: { platform: 'anthropic', fallbackPlatform: 'openai' } });
    expect(loadAIConfig().fallback).toBeUndefined();
  });
});

describe('Apple-FM fallback persistence', () => {
  it('persists the fallback selection via saveAIConfigPreferences', () => {
    setConfigFile({ ai: { platform: 'apple', model: 'apple-on-device' } });
    saveAIConfigPreferences('apple', 'apple-on-device', { fallbackPlatform: 'anthropic', fallbackModel: 'claude-sonnet-4-6' });
    const written = JSON.parse(fsMocks.writeFileSync.mock.calls.at(-1)![1]);
    expect(written.ai.fallbackPlatform).toBe('anthropic');
    expect(written.ai.fallbackModel).toBe('claude-sonnet-4-6');
  });

  it('clears the fallback when an empty platform is saved', () => {
    setConfigFile({ ai: { platform: 'apple', fallbackPlatform: 'anthropic', fallbackModel: 'claude-sonnet-4-6' } });
    saveAIConfigPreferences('apple', 'apple-on-device', { fallbackPlatform: '' });
    const written = JSON.parse(fsMocks.writeFileSync.mock.calls.at(-1)![1]);
    expect(written.ai.fallbackPlatform).toBeUndefined();
    expect(written.ai.fallbackModel).toBeUndefined();
  });

  it('loadFallbackSelection returns the stored selection regardless of primary', () => {
    setConfigFile({ ai: { platform: 'anthropic', fallbackPlatform: 'google', fallbackModel: 'gemini-2.5-flash' } });
    expect(loadFallbackSelection()).toEqual({ platform: 'google', model: 'gemini-2.5-flash' });
  });

  it('loadFallbackSelection returns null when unset', () => {
    setConfigFile({ ai: { platform: 'apple' } });
    expect(loadFallbackSelection()).toBeNull();
  });
});

describe('local platform (GB-904)', () => {
  it('resolveLocalEndpoint defaults to the Ollama endpoint', () => {
    expect(resolveLocalEndpoint()).toBe('http://localhost:11434/v1');
  });

  it('resolveLocalEndpoint reads the configured URL and trims a trailing slash', () => {
    setConfigFile({ ai: { localEndpoint: 'http://host:1234/v1/' } });
    expect(resolveLocalEndpoint()).toBe('http://host:1234/v1');
  });

  it('loadAIConfig sets baseUrl and does NOT remap the local model id', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);
    setConfigFile({ ai: { platform: 'local', model: 'mistral' } });

    const config = loadAIConfig();

    expect(config.platform).toBe('local');
    expect(config.model).toBe('mistral'); // not a cloud alias — left as-is
    expect(config.apiKey).toBeNull(); // keyless
    expect(config.baseUrl).toBe('http://localhost:11434/v1');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('saveAIConfigPreferences persists localEndpoint and clears it when empty', () => {
    saveAIConfigPreferences('local', 'mistral', { localEndpoint: 'http://x:1/v1' });
    let written = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(written.ai.platform).toBe('local');
    expect(written.ai.localEndpoint).toBe('http://x:1/v1');

    vi.clearAllMocks();
    setNoConfigFile();
    saveAIConfigPreferences('local', 'mistral', { localEndpoint: '   ' });
    written = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(written.ai.localEndpoint).toBeUndefined();
  });
});

describe('saveAIConfigPreferences', () => {
  it('writes platform and model to config file', () => {
    saveAIConfigPreferences('openai', 'gpt-4o');

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.glassbox'),
      { recursive: true },
    );
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.ai.platform).toBe('openai');
    expect(writtenData.ai.model).toBe('gpt-4o');
  });

  it('preserves existing config when updating preferences', () => {
    const encoded = Buffer.from('sk-existing').toString('base64');
    setConfigFile({ ai: { keys: { anthropic: encoded } }, guidedReview: { enabled: true, topics: ['security'] } });

    saveAIConfigPreferences('google', 'gemini-2.5-pro');

    const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.ai.platform).toBe('google');
    expect(writtenData.ai.model).toBe('gemini-2.5-pro');
    expect(writtenData.ai.keys.anthropic).toBe(encoded);
    expect(writtenData.guidedReview.enabled).toBe(true);
  });

  it('sets file permissions to 0o600', () => {
    saveAIConfigPreferences('anthropic', 'claude-sonnet-4-6');

    expect(fsMocks.chmodSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      0o600,
    );
  });

  it('handles chmod failure gracefully', () => {
    fsMocks.chmodSync.mockImplementation(() => { throw new Error('permission denied'); });

    expect(() => saveAIConfigPreferences('anthropic', 'test')).not.toThrow();
  });
});

describe('saveAPIKey', () => {
  describe('storage = config', () => {
    it('base64-encodes the key and writes to config', () => {
      saveAPIKey('anthropic', 'sk-my-secret-key', 'config');

      const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.ai.keys.anthropic).toBe(Buffer.from('sk-my-secret-key').toString('base64'));
    });

    it('preserves other platform keys when saving', () => {
      const existingGoogleKey = Buffer.from('google-key').toString('base64');
      setConfigFile({ ai: { keys: { google: existingGoogleKey } } });

      saveAPIKey('anthropic', 'sk-new', 'config');

      const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.ai.keys.anthropic).toBe(Buffer.from('sk-new').toString('base64'));
      expect(writtenData.ai.keys.google).toBe(existingGoogleKey);
    });

    it('creates ai.keys when ai section exists but keys does not', () => {
      setConfigFile({ ai: { platform: 'openai' } });

      saveAPIKey('openai', 'sk-key', 'config');

      const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
      expect(writtenData.ai.keys.openai).toBe(Buffer.from('sk-key').toString('base64'));
      expect(writtenData.ai.platform).toBe('openai');
    });
  });

  describe('storage = keychain', () => {
    it('saves to macOS keychain (darwin)', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      saveAPIKey('anthropic', 'sk-keychain-key', 'keychain');

      // First call: delete old entry
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'security',
        ['delete-generic-password', '-s', 'glassbox', '-a', 'anthropic-api-key'],
        expect.objectContaining({ stdio: 'pipe' }),
      );
      // Second call: add new entry
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'security',
        ['add-generic-password', '-s', 'glassbox', '-a', 'anthropic-api-key', '-w', 'sk-keychain-key'],
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('saves to Linux keyring', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      saveAPIKey('openai', 'sk-linux-key', 'keychain');

      expect(spawnSyncMock).toHaveBeenCalledWith(
        'secret-tool',
        ['store', '--label=Glassbox API Key', 'service', 'glassbox', 'account', 'openai-api-key'],
        expect.objectContaining({ input: 'sk-linux-key', encoding: 'utf-8' }),
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('saves to Windows Credential Manager', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      saveAPIKey('google', 'gemini-key', 'keychain');

      expect(spawnSyncMock).toHaveBeenCalledWith(
        'powershell',
        ['-NoProfile', '-Command', '-'],
        expect.objectContaining({
          input: expect.stringContaining('glassbox-google-api-key'),
          encoding: 'utf-8',
        }),
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('escapes single quotes in key for Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      saveAPIKey('google', "key'with'quotes", 'keychain');

      const call = spawnSyncMock.mock.calls[0];
      const input = call[2].input as string;
      expect(input).toContain("key''with''quotes");

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('does not write to config file when storage is keychain', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      saveAPIKey('anthropic', 'sk-key', 'keychain');

      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });
});

describe('deleteAPIKey', () => {
  it('deletes from macOS keychain and clears config', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const encoded = Buffer.from('old-key').toString('base64');
    setConfigFile({ ai: { keys: { anthropic: encoded } } });

    deleteAPIKey('anthropic');

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'security',
      ['delete-generic-password', '-s', 'glassbox', '-a', 'anthropic-api-key'],
      expect.objectContaining({ stdio: 'pipe' }),
    );

    const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.ai.keys.anthropic).toBe('');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('deletes from Linux keyring and clears config', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const encoded = Buffer.from('old-key').toString('base64');
    setConfigFile({ ai: { keys: { openai: encoded } } });

    deleteAPIKey('openai');

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'secret-tool',
      ['clear', 'service', 'glassbox', 'account', 'openai-api-key'],
      expect.objectContaining({ stdio: 'pipe' }),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('deletes from Windows Credential Manager', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    setConfigFile({ ai: { keys: { google: 'abc' } } });

    deleteAPIKey('google');

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'powershell',
      ['-NoProfile', '-Command', '-'],
      expect.objectContaining({
        input: expect.stringContaining('glassbox-google-api-key'),
      }),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('handles keychain deletion failure gracefully', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    spawnSyncMock.mockImplementation(() => { throw new Error('no such keychain item'); });
    setConfigFile({ ai: { keys: { anthropic: 'abc' } } });

    expect(() => deleteAPIKey('anthropic')).not.toThrow();

    // Config should still be updated even if keychain throws
    const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.ai.keys.anthropic).toBe('');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('does not write config when no keys section exists', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    deleteAPIKey('anthropic');

    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });
});

describe('detectAvailablePlatforms', () => {
  it('returns empty array when no keys are configured', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);

    const platforms = detectAvailablePlatforms();

    expect(platforms).toEqual([]);

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('detects platforms with env keys', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    process.env.OPENAI_API_KEY = 'sk-oai';

    const platforms = detectAvailablePlatforms();

    expect(platforms).toEqual([
      { platform: 'anthropic', source: 'env' },
      { platform: 'openai', source: 'env' },
    ]);
  });

  it('detects all three platforms', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    process.env.OPENAI_API_KEY = 'sk-oai';
    process.env.GEMINI_API_KEY = 'gemini';

    const platforms = detectAvailablePlatforms();

    expect(platforms).toHaveLength(3);
    expect(platforms.map(p => p.platform)).toEqual(['anthropic', 'openai', 'google']);
  });

  it('detects platform with config file key', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    setSpawnResult('', 44);

    const encoded = Buffer.from('sk-config').toString('base64');
    setConfigFile({ ai: { keys: { google: encoded } } });

    const platforms = detectAvailablePlatforms();

    expect(platforms).toEqual([
      { platform: 'google', source: 'config' },
    ]);

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });
});

describe('isKeychainAvailable', () => {
  it('returns true on darwin', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    expect(isKeychainAvailable()).toBe(true);

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns true on win32', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    expect(isKeychainAvailable()).toBe(true);

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns true on linux when secret-tool is available', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    spawnSyncMock.mockReturnValue({ status: 0 });

    expect(isKeychainAvailable()).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith('which', ['secret-tool'], { stdio: 'pipe' });

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns false on linux when secret-tool is not available', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    spawnSyncMock.mockReturnValue({ status: 1 });

    expect(isKeychainAvailable()).toBe(false);

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns false on unsupported platform', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'freebsd' });

    expect(isKeychainAvailable()).toBe(false);

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });
});

describe('loadGuidedReviewConfig', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadGuidedReviewConfig();

    expect(config).toEqual({ enabled: false, topics: [] });
  });

  it('returns defaults when config has no guidedReview section', () => {
    setConfigFile({ ai: { platform: 'anthropic' } });

    const config = loadGuidedReviewConfig();

    expect(config).toEqual({ enabled: false, topics: [] });
  });

  it('reads enabled flag and topics from config', () => {
    setConfigFile({
      guidedReview: { enabled: true, topics: ['security', 'performance', 'accessibility'] },
    });

    const config = loadGuidedReviewConfig();

    expect(config.enabled).toBe(true);
    expect(config.topics).toEqual(['security', 'performance', 'accessibility']);
  });

  it('defaults enabled to false when only topics are set', () => {
    setConfigFile({ guidedReview: { topics: ['testing'] } });

    const config = loadGuidedReviewConfig();

    expect(config.enabled).toBe(false);
    expect(config.topics).toEqual(['testing']);
  });

  it('defaults topics to empty array when only enabled is set', () => {
    setConfigFile({ guidedReview: { enabled: true } });

    const config = loadGuidedReviewConfig();

    expect(config.enabled).toBe(true);
    expect(config.topics).toEqual([]);
  });
});

describe('saveGuidedReviewConfig', () => {
  it('writes guided review settings to config file', () => {
    saveGuidedReviewConfig({ enabled: true, topics: ['security', 'testing'] });

    const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.guidedReview).toEqual({
      enabled: true,
      topics: ['security', 'testing'],
    });
  });

  it('preserves existing config when saving guided review', () => {
    setConfigFile({ ai: { platform: 'openai', model: 'gpt-4o' } });

    saveGuidedReviewConfig({ enabled: false, topics: [] });

    const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.ai.platform).toBe('openai');
    expect(writtenData.ai.model).toBe('gpt-4o');
    expect(writtenData.guidedReview).toEqual({ enabled: false, topics: [] });
  });

  it('overwrites previous guided review config', () => {
    setConfigFile({ guidedReview: { enabled: true, topics: ['old-topic'] } });

    saveGuidedReviewConfig({ enabled: false, topics: ['new-topic'] });

    const writtenData = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.guidedReview).toEqual({ enabled: false, topics: ['new-topic'] });
  });
});
