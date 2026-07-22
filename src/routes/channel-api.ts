import { spawnSync } from 'child_process';
import { mkdirSync } from 'fs';
import { Hono } from 'hono';
import { join } from 'path';

import { TriggerChannelReqSchema } from '../api/index.js';
import { isChannelAlive, registerChannel, triggerChannel, unregisterChannel } from '../channel-config.js';
import { readGlobalConfig, updateGlobalConfig } from '../global-config.js';
import type { AppEnv } from '../types.js';
import { compareVersions } from '../utils/compareVersions.js';
import { errorResponse, parseBody } from '../utils/parseBody.js';

/** Minimum Claude Code CLI version with working channel support (the
 *  experimental `claude/channel` capability landed in 2.1.80). */
const MIN_CLAUDE_VERSION = '2.1.80';

export const channelApiRoutes = new Hono<AppEnv>();

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
  updateGlobalConfig((config) => { config.channelEnabled = true; });

  const repoRoot = c.get('repoRoot');
  const dataDir = join(repoRoot, '.glassbox');
  mkdirSync(dataDir, { recursive: true });
  registerChannel(dataDir);

  return c.json({ ok: true } as const);
});

/** POST /channel/disable — disable channel and remove from .mcp.json */
channelApiRoutes.post('/disable', (c) => {
  updateGlobalConfig((config) => { config.channelEnabled = false; });

  const repoRoot = c.get('repoRoot');
  const dataDir = join(repoRoot, '.glassbox');
  unregisterChannel(dataDir);

  return c.json({ ok: true } as const);
});

/** POST /channel/trigger — send a message to Claude via the channel */
channelApiRoutes.post('/trigger', async (c) => {
  const parsed = await parseBody(c, TriggerChannelReqSchema);
  if (!parsed.ok) return parsed.response;
  const repoRoot = c.get('repoRoot');
  const dataDir = join(repoRoot, '.glassbox');
  const sent = await triggerChannel(dataDir, parsed.data.message);
  if (!sent) {
    return errorResponse(c, 'Channel not connected', 503);
  }
  return c.json({ ok: true } as const);
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
    const meetsMinimum = ver !== null && compareVersions(ver, MIN_CLAUDE_VERSION) >= 0;
    return c.json({ installed: true, version: ver, meetsMinimum });
  } catch {
    return c.json({ installed: false, version: null, meetsMinimum: false });
  }
});
