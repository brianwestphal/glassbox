import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getChannelPort, getChannelSecret, registerChannel, triggerChannel, unregisterChannel } from '../../src/channel-config.js';

/**
 * GB-829 — the `.mcp.json` register/parse helpers in `channel-config.ts` (the
 * core of the Claude-channel integration) had ~no direct coverage. These tests
 * exercise the pure read/merge/write/parse logic against a temp project dir.
 */
describe('channel-config (.mcp.json management)', () => {
  let root: string;
  let dataDir: string;
  const mcpPath = () => join(root, '.mcp.json');
  const readMcp = () => JSON.parse(readFileSync(mcpPath(), 'utf-8')) as {
    mcpServers?: Record<string, { command: string; args: string[] }>;
    [k: string]: unknown;
  };
  const writePortFile = (contents: string) => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'channel-port'), contents, 'utf-8');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gb-channel-'));
    dataDir = join(root, '.glassbox');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('registerChannel', () => {
    it('writes a glassbox-channel server entry carrying the data dir', () => {
      registerChannel(dataDir);
      const entry = readMcp().mcpServers?.['glassbox-channel'];
      expect(entry).toBeDefined();
      expect(entry?.args).toContain('--data-dir');
      expect(entry?.args).toContain(dataDir);
    });

    it('preserves unrelated mcpServers and top-level keys in an existing file', () => {
      writeFileSync(mcpPath(), JSON.stringify({
        mcpServers: { 'other-tool': { command: 'foo', args: ['bar'] } },
        someTopLevelKey: 42,
      }), 'utf-8');

      registerChannel(dataDir);
      const cfg = readMcp();
      expect(cfg.mcpServers?.['other-tool']).toEqual({ command: 'foo', args: ['bar'] });
      expect(cfg.mcpServers?.['glassbox-channel']).toBeDefined();
      expect(cfg.someTopLevelKey).toBe(42); // .loose() passes unknown keys through
    });

    it('overwrites a corrupt .mcp.json instead of throwing', () => {
      writeFileSync(mcpPath(), '{ not valid json', 'utf-8');
      expect(() => { registerChannel(dataDir); }).not.toThrow();
      expect(readMcp().mcpServers?.['glassbox-channel']).toBeDefined();
    });
  });

  describe('unregisterChannel', () => {
    it('removes only the glassbox-channel entry, leaving others intact', () => {
      writeFileSync(mcpPath(), JSON.stringify({
        mcpServers: { 'other-tool': { command: 'foo', args: [] } },
      }), 'utf-8');
      registerChannel(dataDir);
      expect(readMcp().mcpServers?.['glassbox-channel']).toBeDefined();

      unregisterChannel(dataDir);
      const cfg = readMcp();
      expect(cfg.mcpServers?.['glassbox-channel']).toBeUndefined();
      expect(cfg.mcpServers?.['other-tool']).toBeDefined();
    });

    it('is a no-op when the file does not exist', () => {
      expect(existsSync(mcpPath())).toBe(false);
      expect(() => { unregisterChannel(dataDir); }).not.toThrow();
    });
  });

  describe('getChannelPort', () => {
    it('returns the parsed port, or null for missing / non-numeric', () => {
      expect(getChannelPort(dataDir)).toBeNull();   // file missing
      writePortFile('4173\n');
      expect(getChannelPort(dataDir)).toBe(4173);   // present + numeric
      writePortFile('not-a-port');
      expect(getChannelPort(dataDir)).toBeNull();   // non-numeric
    });
  });

  describe('getChannelSecret (GB-1080)', () => {
    it('returns the trimmed secret, or null for missing / empty', () => {
      expect(getChannelSecret(dataDir)).toBeNull();  // file missing
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'channel-secret'), 'shh-token\n', 'utf-8');
      expect(getChannelSecret(dataDir)).toBe('shh-token');
      writeFileSync(join(dataDir, 'channel-secret'), '  \n', 'utf-8');
      expect(getChannelSecret(dataDir)).toBeNull();  // blank
    });
  });

  describe('triggerChannel sends the shared secret (GB-1080)', () => {
    it('refuses to fire without a secret file, and sends X-Glassbox-Secret with one', async () => {
      // No secret on disk → no request is attempted at all.
      writePortFile('1');
      expect(await triggerChannel(dataDir, 'msg')).toBe(false);

      // With a secret: round-trip against a real local server capturing headers.
      const seen: { header?: string; body?: string } = {};
      const srv = createServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => { body += String(c); });
        req.on('end', () => {
          seen.header = typeof req.headers['x-glassbox-secret'] === 'string' ? req.headers['x-glassbox-secret'] : undefined;
          seen.body = body;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        });
      });
      await new Promise<void>((resolve) => { srv.listen(0, '127.0.0.1', resolve); });
      const port = (srv.address() as AddressInfo).port;
      writePortFile(String(port));
      writeFileSync(join(dataDir, 'channel-secret'), 'shh-token', 'utf-8');
      try {
        expect(await triggerChannel(dataDir, 'apply it')).toBe(true);
        expect(seen.header).toBe('shh-token');
        expect(seen.body).toBe('apply it');
      } finally {
        await new Promise<void>((resolve) => { srv.close(() => { resolve(); }); });
      }
    });
  });
});
