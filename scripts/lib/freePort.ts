// Shared free-port scan for the capture scripts (demo hero, stills, ground-truth).
//
// All three boot a real Glassbox server with `--strict-port` so it binds the
// exact port we asked for (no silent fallback). Picking that port with a scan
// — rather than a fixed number — means an unrelated local process squatting on
// the default (a stray `npx serve`, a `python -m http.server`, another dev
// server) costs one port rather than making the capture fail with a cryptic
// "server never came up" timeout.
//
// A bind test on `127.0.0.1` alone is NOT enough: a dual-stack process bound to
// the IPv6 wildcard (`*:PORT`, i.e. `::`) can coexist with a *specific* IPv4
// bind, so `createServer().listen(port, '127.0.0.1')` "succeeds" — yet Glassbox
// (which also binds `127.0.0.1`) then can't reliably claim the port, and its
// spawn fails after logging "running". So we ALSO probe for an existing listener
// by connecting on both loopback families; if anything answers, the port is
// occupied and the scan moves on.

import { createConnection, createServer } from 'node:net';

/** Whether we can bind a listener on `127.0.0.1:port` right now. */
function canBind(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = createServer();
    probe.once('error', () => { resolve(false); });
    probe.once('listening', () => { probe.close(() => { resolve(true); }); });
    probe.listen(port, '127.0.0.1');
  });
}

/** Whether something is already accepting connections on `host:port`. */
function isListening(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = createConnection({ host, port });
    const settle = (v: boolean): void => { sock.destroy(); resolve(v); };
    sock.setTimeout(300);
    sock.once('connect', () => { settle(true); });
    sock.once('timeout', () => { settle(false); });
    sock.once('error', () => { settle(false); });
  });
}

/** A port is free only if nothing is listening on either loopback family AND we
 *  can bind it ourselves — catches a dual-stack IPv6 squatter a bind-only test
 *  on 127.0.0.1 would miss. */
async function isPortFree(port: number): Promise<boolean> {
  if (await isListening('127.0.0.1', port)) return false;
  if (await isListening('::1', port)) return false;
  return canBind(port);
}

/** The first free port at or above `from`, so an unrelated process squatting
 *  inside the scan range costs a port rather than a capture. */
export async function nextFreePort(from: number): Promise<number> {
  for (let port = from; port < from + 100; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in ${String(from)}..${String(from + 99)}`);
}
