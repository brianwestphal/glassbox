#!/usr/bin/env node
/**
 * Glassbox Channel Server for Claude Code.
 * MCP server that bridges Glassbox UI → Claude Code session.
 * Spawned by Claude Code as a subprocess via .mcp.json.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { unlinkSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { join } from 'path';

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

// Connect to Claude Code over stdio
await mcp.connect(new StdioServerTransport());

// Start HTTP server for Glassbox to POST commands
// eslint-disable-next-line @typescript-eslint/no-misused-promises
const httpServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/trigger') {
    let body = '';
    let bodySize = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      bodySize += chunk.length;
      if (bodySize > 1_048_576) { res.writeHead(413); res.end('Payload too large'); return; }
      body += String(chunk);
    }

    try {
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: body || 'Read .glassbox/latest-review.md and apply the feedback.',
          meta: { type: 'review-feedback' },
        },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

// Find an available port
httpServer.listen(0, '127.0.0.1', () => {
  const addr = httpServer.address();
  if (addr !== null && typeof addr !== 'string') {
    const port = addr.port;
    try {
      writeFileSync(portFile, String(port), 'utf-8');
    } catch { /* data dir may not exist yet */ }
    process.stderr.write(`glassbox-channel listening on port ${port}\n`);
  }
});

// Cleanup on exit
function cleanup() {
  try { unlinkSync(portFile); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGTERM', () => { cleanup(); });
process.on('SIGINT', () => { cleanup(); });
process.on('exit', () => { try { unlinkSync(portFile); } catch { /* ignore */ } });
