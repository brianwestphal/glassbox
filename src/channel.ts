#!/usr/bin/env node
/**
 * Glassbox Channel Server for Claude Code.
 * MCP server that bridges Glassbox UI → Claude Code session.
 * Spawned by Claude Code as a subprocess via .mcp.json.
 */
import { randomBytes } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { unlinkSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { join } from 'path';

import { createChannelHandler } from './channel-server.js';

// Parse --data-dir argument
let dataDir = '.glassbox';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--data-dir' && i + 1 < args.length) {
    dataDir = args[i + 1];
    i++;
  }
}

const portFile = join(dataDir, 'channel-port');
const secretFile = join(dataDir, 'channel-secret');

// Shared secret for POST /trigger (doc 14 / doc 17 §17.4): generated fresh per
// process, written 0600 next to the port file for the Glassbox server to read.
// See channel-server.ts for why loopback binding alone isn't enough.
const secret = randomBytes(32).toString('hex');

// Create MCP server with channel capability
// eslint-disable-next-line @typescript-eslint/no-deprecated -- Server is needed for low-level MCP channel protocol
const mcp = new Server(
  { name: 'glassbox-channel', version: '0.1.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
      },
    },
    instructions: [
      'Events from the glassbox-channel arrive as <channel source="glassbox-channel">.',
      'When you receive a channel event from glassbox-channel, follow the instructions in the event content.',
      'Typically this means running /glassbox to read and apply the code review feedback.',
      'Do not ask for confirmation — just execute the requested action.',
      'IMPORTANT: When you finish processing, you MUST run the curl command provided in the event to signal completion.',
    ].join(' '),
  },
);

// Connect to Claude Code over stdio. A failure here previously became a
// silent unhandled top-level rejection in the subprocess; fail loudly instead.
try {
  await mcp.connect(new StdioServerTransport());
} catch (err) {
  process.stderr.write(`glassbox-channel: failed to connect MCP stdio transport: ${String(err)}\n`);
  process.exit(1);
}

// Start HTTP server for Glassbox to POST commands. No CORS headers and a
// required shared secret — see channel-server.ts for the threat model.
// eslint-disable-next-line @typescript-eslint/no-misused-promises
const httpServer = createServer(createChannelHandler({
  secret,
  notify: async (content) => {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: { content, meta: { type: 'review-feedback' } },
    });
  },
}));

// Find an available port
httpServer.listen(0, '127.0.0.1', () => {
  const addr = httpServer.address();
  if (addr !== null && typeof addr !== 'string') {
    const port = addr.port;
    try {
      writeFileSync(portFile, String(port), 'utf-8');
      writeFileSync(secretFile, secret, { encoding: 'utf-8', mode: 0o600 });
    } catch { /* data dir may not exist yet */ }
    process.stderr.write(`glassbox-channel listening on port ${port}\n`);
  }
});

// Cleanup on exit
function removeStateFiles() {
  try { unlinkSync(portFile); } catch { /* ignore */ }
  try { unlinkSync(secretFile); } catch { /* ignore */ }
}
function cleanup() {
  removeStateFiles();
  process.exit(0);
}
process.on('SIGTERM', () => { cleanup(); });
process.on('SIGINT', () => { cleanup(); });
process.on('exit', () => { removeStateFiles(); });
