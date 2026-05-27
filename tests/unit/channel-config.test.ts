import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getChannelPort, registerChannel, unregisterChannel } from '../../src/channel-config.js';

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
});
