import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncomingMessage } from 'http';
import { EventEmitter } from 'events';

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock https
vi.mock('https', () => ({
  get: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { get } from 'https';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockGet = vi.mocked(get);

function createMockResponse(statusCode: number, body: string): IncomingMessage {
  const res = new EventEmitter() as IncomingMessage;
  res.statusCode = statusCode;
  // Schedule data emission asynchronously
  process.nextTick(() => {
    res.emit('data', Buffer.from(body));
    res.emit('end');
  });
  return res;
}

function createMockRequest(): EventEmitter & { destroy: () => void } {
  const req = new EventEmitter() as EventEmitter & { destroy: () => void };
  req.destroy = vi.fn();
  return req;
}

describe('checkForUpdates', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Default: package.json returns a known version
    mockReadFileSync.mockImplementation((path: any) => {
      if (typeof path === 'string' && path.includes('package.json')) {
        return JSON.stringify({ version: '1.0.0' });
      }
      // For last-update-check file
      return '';
    });
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockReturnValue(undefined as any);
    mockWriteFileSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns early when already checked today and force is false', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: any) => {
      if (typeof path === 'string' && path.includes('package.json')) {
        return JSON.stringify({ version: '1.0.0' });
      }
      return today;
    });

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    // Should not call https.get since it returned early
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('checks when force is true even if already checked today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: any) => {
      if (typeof path === 'string' && path.includes('package.json')) {
        return JSON.stringify({ version: '1.0.0' });
      }
      return today;
    });

    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ version: '1.0.0' }));
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(true);

    // Should have made the fetch call
    expect(mockGet).toHaveBeenCalled();
  });

  it('logs update message when newer version is available', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ version: '2.0.0' }));
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    const logOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(logOutput).toContain('Update available');
    expect(logOutput).toContain('2.0.0');
  });

  it('does not log when current version is up to date', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ version: '1.0.0' }));
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    const logOutput = consoleSpy.mock.calls.map(c => c[0] ?? '').join('\n');
    expect(logOutput).not.toContain('Update available');
  });

  it('handles fetch errors gracefully', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    mockGet.mockImplementation((_url: any, _opts: any, _cb: any) => {
      process.nextTick(() => req.emit('error', new Error('network failure')));
      return req as any;
    });

    const { checkForUpdates } = await import('../../src/update-check.js');
    // Should not throw
    await checkForUpdates(false);

    // No update message logged
    const logOutput = consoleSpy.mock.calls.map(c => c[0] ?? '').join('\n');
    expect(logOutput).not.toContain('Update available');
  });

  it('handles non-200 status codes gracefully', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    const res = createMockResponse(404, 'Not found');
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    const logOutput = consoleSpy.mock.calls.map(c => c[0] ?? '').join('\n');
    expect(logOutput).not.toContain('Update available');
  });

  it('saves check date after checking', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ version: '1.0.0' }));
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    expect(mockWriteFileSync).toHaveBeenCalled();
    const writeCall = mockWriteFileSync.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('last-update-check')
    );
    expect(writeCall).toBeDefined();
    // The written date should be today
    const today = new Date().toISOString().slice(0, 10);
    expect(writeCall![1]).toBe(today);
  });

  it('detects npm as default package manager', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ version: '2.0.0' }));
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const originalArgv1 = process.argv[1];
    process.argv[1] = '/usr/local/bin/glassbox';

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    process.argv[1] = originalArgv1;

    const logOutput = consoleSpy.mock.calls.map(c => c[0] ?? '').join('\n');
    expect(logOutput).toContain('npm update -g glassbox');
  });

  it('detects bun package manager from binary path', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ version: '2.0.0' }));
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const originalArgv1 = process.argv[1];
    process.argv[1] = '/home/user/.bun/bin/glassbox';

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    process.argv[1] = originalArgv1;

    const logOutput = consoleSpy.mock.calls.map(c => c[0] ?? '').join('\n');
    expect(logOutput).toContain('bun update -g glassbox');
  });

  it('detects pnpm package manager from binary path', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ version: '2.0.0' }));
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const originalArgv1 = process.argv[1];
    process.argv[1] = '/home/user/.pnpm/bin/glassbox';

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    process.argv[1] = originalArgv1;

    const logOutput = consoleSpy.mock.calls.map(c => c[0] ?? '').join('\n');
    expect(logOutput).toContain('pnpm update -g glassbox');
  });

  it('detects yarn package manager from binary path', async () => {
    mockExistsSync.mockReturnValue(false);

    const req = createMockRequest();
    const res = createMockResponse(200, JSON.stringify({ version: '2.0.0' }));
    mockGet.mockImplementation((_url: any, _opts: any, cb: any) => {
      cb(res);
      return req as any;
    });

    const originalArgv1 = process.argv[1];
    process.argv[1] = '/home/user/.yarn/bin/glassbox';

    const { checkForUpdates } = await import('../../src/update-check.js');
    await checkForUpdates(false);

    process.argv[1] = originalArgv1;

    const logOutput = consoleSpy.mock.calls.map(c => c[0] ?? '').join('\n');
    expect(logOutput).toContain('yarn global upgrade glassbox');
  });
});
