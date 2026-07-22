/**
 * HTTP request handler for the Glassbox channel server (doc 17), extracted
 * from `channel.ts` so it can be unit tested (the entry script itself
 * top-level-awaits an MCP stdio connection and can only run as a subprocess).
 *
 * Security posture (doc 14 / doc 17 §17.4): `POST /trigger` injects its body
 * into a Claude Code session that is pre-instructed to execute without
 * confirmation, so it must not be reachable by a browser page. Loopback
 * binding alone does not guarantee that — a malicious page in the user's own
 * browser can fire a no-preflight "simple request" POST at
 * `http://127.0.0.1:<port>/trigger` (CORS only blocks *reading* the response,
 * not sending the request). Two layers close it:
 *
 * 1. **No CORS headers.** Nothing legitimate calls this from a browser — the
 *    only caller is the Glassbox Node server (`triggerChannel`), server-to-
 *    server. (An earlier version sent `Access-Control-Allow-Origin: *`.)
 * 2. **A shared secret.** The server generates a random token at startup and
 *    writes it next to the port file (`channel-secret`, 0600); `/trigger`
 *    requires it in the `X-Glassbox-Secret` header. A browser page cannot
 *    read the file, and sending the custom header would force a CORS
 *    preflight that now fails. `/health` stays open — it only answers
 *    `{ok:true}` for liveness checks.
 */
import { timingSafeEqual } from 'node:crypto';

import type { IncomingMessage, ServerResponse } from 'http';

const MAX_BODY_BYTES = 1_048_576;

export interface ChannelHandlerDeps {
  /** Forward a trigger body into the Claude session (MCP notification). */
  notify: (content: string) => Promise<void>;
  /** The shared secret required on POST /trigger. */
  secret: string;
}

function secretMatches(provided: string | string[] | undefined, secret: string): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Build the channel server's request handler. */
export function createChannelHandler(deps: ChannelHandlerDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && req.url === '/trigger') {
      if (!secretMatches(req.headers['x-glassbox-secret'], deps.secret)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid X-Glassbox-Secret' }));
        return;
      }

      let body = '';
      let bodySize = 0;
      for await (const chunk of req as AsyncIterable<Buffer>) {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_BYTES) { res.writeHead(413); res.end('Payload too large'); return; }
        body += String(chunk);
      }

      try {
        await deps.notify(body || 'Read .glassbox/latest-review.md and apply the feedback.');
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
  };
}
