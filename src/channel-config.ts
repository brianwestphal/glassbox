import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const MCP_SERVER_KEY = 'glassbox-channel';

/** Shape of `.mcp.json`. Permissive (`.loose()`) so unrelated tool keys
 *  the user has configured pass through unmodified. */
const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
}).loose();
type McpConfig = z.infer<typeof McpConfigSchema>;

const HealthResponseSchema = z.object({ ok: z.boolean() });

/** Get the path to the channel server and the command to run it. */
function getChannelServerPath(): { command: string; args: string[] } {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  // Production: this file is dist/channel-config.js, sibling is dist/channel.js
  const distPath = resolve(thisDir, 'channel.js');
  if (existsSync(distPath)) {
    return { command: process.execPath, args: [distPath] };
  }

  // Dev mode: this file is src/channel-config.ts, sibling is src/channel.ts
  const srcPath = resolve(thisDir, 'channel.ts');
  if (existsSync(srcPath)) {
    return { command: 'npx', args: ['tsx', srcPath] };
  }

  return { command: process.execPath, args: [distPath] };
}

/** Get the project root directory (parent of .glassbox/). Accepts either path
 *  separator — on Windows `dataDir` is backslashed, so a forward-slash-only
 *  match would leave `.glassbox` in place and write `.mcp.json` into it. */
function projectRoot(dataDir: string): string {
  return dataDir.replace(/[/\\]\.glassbox[/\\]?$/, '');
}

/** Register the channel server in .mcp.json for a specific project */
export function registerChannel(dataDir: string): void {
  const root = projectRoot(dataDir);
  const mcpPath = join(root, '.mcp.json');
  const { command, args } = getChannelServerPath();

  let config: McpConfig = {};
  if (existsSync(mcpPath)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      const parsed = McpConfigSchema.safeParse(raw);
      if (parsed.success) config = parsed.data;
    } catch { /* corrupt, overwrite */ }
  }

  if (config.mcpServers === undefined) config.mcpServers = {};
  config.mcpServers[MCP_SERVER_KEY] = {
    command,
    args: [...args, '--data-dir', dataDir],
  };

  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Remove the channel server from .mcp.json */
export function unregisterChannel(dataDir: string): void {
  const root = projectRoot(dataDir);
  const mcpPath = join(root, '.mcp.json');

  if (!existsSync(mcpPath)) return;

  try {
    const raw: unknown = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    const parsed = McpConfigSchema.safeParse(raw);
    if (!parsed.success) return;
    const config = parsed.data;
    if (config.mcpServers?.[MCP_SERVER_KEY] !== undefined) {
      const servers = { ...config.mcpServers };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete servers[MCP_SERVER_KEY];
      config.mcpServers = servers;
      writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }
  } catch { /* ignore */ }
}

/** Read the channel port from the port file */
export function getChannelPort(dataDir: string): number | null {
  try {
    const portStr = readFileSync(join(dataDir, 'channel-port'), 'utf-8').trim();
    const port = parseInt(portStr, 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

/** Check if the channel server is reachable */
export async function isChannelAlive(dataDir: string): Promise<boolean> {
  const port = getChannelPort(dataDir);
  if (port === null) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const raw: unknown = await res.json();
    const parsed = HealthResponseSchema.safeParse(raw);
    return parsed.success && parsed.data.ok;
  } catch {
    return false;
  }
}

/** Read the channel shared secret written next to the port file (doc 17 §17.4). */
export function getChannelSecret(dataDir: string): string | null {
  try {
    const secret = readFileSync(join(dataDir, 'channel-secret'), 'utf-8').trim();
    return secret === '' ? null : secret;
  } catch {
    return null;
  }
}

/** Send a trigger to the channel server. Requires the shared secret the
 *  channel server wrote at startup — POST /trigger rejects without it (the
 *  guard against browser-page "simple request" POSTs; see channel-server.ts). */
export async function triggerChannel(dataDir: string, message: string): Promise<boolean> {
  const port = getChannelPort(dataDir);
  const secret = getChannelSecret(dataDir);
  if (port === null || secret === null) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/trigger`, {
      method: 'POST',
      headers: { 'X-Glassbox-Secret': secret },
      body: message,
    });
    return res.ok;
  } catch {
    return false;
  }
}
