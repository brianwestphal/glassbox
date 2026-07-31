/**
 * Behavioral tests for the smoke scripts' shared port resolver
 * (`tests/smoke/smoke-lib.sh`).
 *
 * The conventions suite pins that each smoke script *calls* the resolver; this
 * pins that the resolver actually works. It is shell, so it is driven the way
 * the smoke scripts drive it — sourced into a real bash process.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIB = join(ROOT, 'tests', 'smoke', 'smoke-lib.sh');

/** Run a snippet with the lib sourced, exactly as a smoke script would. */
function runWithLib(snippet: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', ['-c', `set -euo pipefail\nsource "${LIB}"\n${snippet}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// The occupied port is held by a SEPARATE process, not an in-process server.
// `runWithLib` uses spawnSync, which blocks this process's event loop for the
// duration of the call — an in-process server could never accept the probe's
// connection while that ran, and since the kernel still completes the handshake
// into the backlog, the probe would block until its own timeout on every call.
let busy: ChildProcess;
let busyPort: number;

beforeAll(async () => {
  busy = spawn(process.execPath, [
    '-e',
    `const s=require('http').createServer((q,r)=>r.end('ok'));
     s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  busyPort = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('port holder did not start')); }, 10_000);
    busy.stdout?.once('data', (chunk: Buffer) => {
      clearTimeout(timer);
      resolve(Number(chunk.toString().trim()));
    });
  });
});

afterAll(() => { busy.kill(); });

describe('smoke_port_in_use', () => {
  it('reports a port with a live listener as in use', () => {
    const r = runWithLib(`smoke_port_in_use ${busyPort} && echo BUSY || echo FREE`);
    expect(r.stdout.trim()).toBe('BUSY');
  });

  it('reports a port with nothing listening as free', () => {
    // Port 1 is privileged and unbound in every environment the suite runs in.
    const r = runWithLib('smoke_port_in_use 1 && echo BUSY || echo FREE');
    expect(r.stdout.trim()).toBe('FREE');
  });
});

describe('smoke_resolve_port', () => {
  it('uses the default port when it is free', () => {
    const r = runWithLib('smoke_resolve_port 1 GB_TEST_PORT; echo "picked=$SMOKE_PORT"');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('picked=1');
  });

  it('prefers the override variable over the default', () => {
    const r = runWithLib('smoke_resolve_port 4199 GB_TEST_PORT; echo "picked=$SMOKE_PORT"', {
      GB_TEST_PORT: '1',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('picked=1');
  });

  it('ignores an empty override and falls back to the default', () => {
    const r = runWithLib('smoke_resolve_port 1 GB_TEST_PORT; echo "picked=$SMOKE_PORT"', {
      GB_TEST_PORT: '',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('picked=1');
  });

  // The bug this whole helper exists for: without the pre-flight check the
  // server started anyway and died on an unhandled EADDRINUSE stack trace,
  // which read as a failure of the code under test rather than a busy port.
  it('fails with a message naming the port and the override variable when taken', () => {
    const r = runWithLib(`smoke_resolve_port ${busyPort} GB_TEST_PORT; echo "picked=$SMOKE_PORT"`);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('picked=');
    expect(r.stderr).toContain(`port ${busyPort} is already in use`);
    expect(r.stderr).toContain('GB_TEST_PORT=<port>');
  });

  it('fails the same way when the override itself points at a taken port', () => {
    const r = runWithLib('smoke_resolve_port 1 GB_TEST_PORT', { GB_TEST_PORT: String(busyPort) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`port ${busyPort} is already in use`);
  });

  // `exit` inside a `$(...)` substitution only leaves the subshell, so the
  // resolver sets a variable instead of echoing one. If it ever goes back to
  // echoing, a caller would sail past a busy port with an empty value.
  it('aborts the calling script rather than continuing past a busy port', () => {
    const r = runWithLib(`smoke_resolve_port ${busyPort} GB_TEST_PORT\necho REACHED_NEXT_LINE`);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('REACHED_NEXT_LINE');
  });
});
