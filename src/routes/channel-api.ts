import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { Hono } from 'hono';
import { homedir } from 'os';
import { join } from 'path';

import { isChannelAlive, registerChannel, triggerChannel, unregisterChannel } from '../channel-config.js';
import type { AppEnv } from '../types.js';

export const channelApiRoutes = new Hono<AppEnv>();

const CONFIG_DIR = join(homedir(), '.glassbox');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

function readGlobalConfig(): Record<string, unknown> {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    }
  } catch { /* corrupt */ }
  return {};
}

function writeGlobalConfig(config: Record<string, unknown>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/** GET /channel/status — check if channel is enabled and connected */
channelApiRoutes.get('/status', async (c) => {
  const config = readGlobalConfig();
  const enabled = config.channelEnabled === true;
  const repoRoot = c.get('repoRoot');
  const dataDir = join(repoRoot, '.glassbox');
  const connected = enabled ? await isChannelAlive(dataDir) : false;
  return c.json({ enabled, connected });
});

/** POST /channel/enable — enable channel and register in .mcp.json */
channelApiRoutes.post('/enable', (c) => {
  const config = readGlobalConfig();
  config.channelEnabled = true;
  writeGlobalConfig(config);

  const repoRoot = c.get('repoRoot');
  const dataDir = join(repoRoot, '.glassbox');
  mkdirSync(dataDir, { recursive: true });
  registerChannel(dataDir);

  return c.json({ ok: true });
});

/** POST /channel/disable — disable channel and remove from .mcp.json */
channelApiRoutes.post('/disable', (c) => {
  const config = readGlobalConfig();
  config.channelEnabled = false;
  writeGlobalConfig(config);

  const repoRoot = c.get('repoRoot');
  const dataDir = join(repoRoot, '.glassbox');
  unregisterChannel(dataDir);

  return c.json({ ok: true });
});

/** POST /channel/trigger — send a message to Claude via the channel */
channelApiRoutes.post('/trigger', async (c) => {
  const body = await c.req.json<{ message: string }>();
  const repoRoot = c.get('repoRoot');
  const dataDir = join(repoRoot, '.glassbox');
  const sent = await triggerChannel(dataDir, body.message);
  if (!sent) {
    return c.json({ error: 'Channel not connected' }, 503);
  }
  return c.json({ ok: true });
});

/** GET /channel/claude-check — check if Claude Code CLI is installed */
channelApiRoutes.get('/claude-check', (c) => {
  try {
    const result = spawnSync('claude', ['--version'], { encoding: 'utf-8', timeout: 5000 });
    if (result.status !== 0) {
      return c.json({ installed: false, version: null, meetsMinimum: false });
    }
    const version = result.stdout.trim();
    // Extract version number (e.g., "claude v2.1.80" → "2.1.80")
    const match = version.match(/(\d+\.\d+\.\d+)/);
    const ver = match !== null ? match[1] : null;
    // Check minimum version (2.1.80)
    let meetsMinimum = false;
    if (ver !== null) {
      const parts = ver.split('.').map(Number);
      meetsMinimum = parts[0] > 2 || (parts[0] === 2 && parts[1] > 1) || (parts[0] === 2 && parts[1] === 1 && parts[2] >= 80);
    }
    return c.json({ installed: true, version: ver, meetsMinimum });
  } catch {
    return c.json({ installed: false, version: null, meetsMinimum: false });
  }
});
