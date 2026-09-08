/**
 * Behavioral tests for `scripts/release/install-published.sh`, the release
 * smoke jobs' "install the version we just published" step.
 *
 * The script exists because a release run once had the fresh-install smoke
 * fail on a version that existed (the registry listed it six minutes after
 * `npm publish` returned) while the upgrade smoke PASSED without upgrading
 * (its retry loop had no failure exit, so the smoke ran against the old
 * stable). These tests drive the real bash script against a fake `npm` on
 * PATH that scripts the registry's behavior: how many probes until the
 * version is visible, how many installs fail first, and what version the
 * install actually lands.
 */
import { spawnSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'release', 'install-published.sh');

let sandbox: string;

/**
 * A fake `npm` that records every invocation to `calls.log` and behaves per
 * the FAKE_NPM_* env: `view` reports the version only from the Nth probe on,
 * `install -g` fails the first M times then "installs" (writes a package.json
 * under the fake global root with FAKE_NPM_INSTALLED_VERSION, or the
 * requested version by default), and `root -g` points at that root.
 */
function writeFakeNpm(dir: string) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'npm'),
    `#!/usr/bin/env bash
set -e
state="$FAKE_NPM_STATE"
echo "$*" >> "$state/calls.log"
case "$1" in
  view)
    n=$(( $(cat "$state/views" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$state/views"
    if [ "$n" -ge "\${FAKE_NPM_VISIBLE_AFTER:-1}" ]; then
      spec="$2"; echo "\${spec#glassbox@}"
    fi
    ;;
  install)
    n=$(( $(cat "$state/installs" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$state/installs"
    if [ "$n" -le "\${FAKE_NPM_INSTALL_FAIL_TIMES:-0}" ]; then echo "npm error EAI_AGAIN" >&2; exit 1; fi
    # An install that exits 0 without producing a package (a wrapper that
    # swallowed the error).
    if [ -n "\${FAKE_NPM_INSTALL_NOOP:-}" ]; then exit 0; fi
    for a in "$@"; do case "$a" in glassbox@*) spec="$a";; esac; done
    v="\${FAKE_NPM_INSTALLED_VERSION:-\${spec#glassbox@}}"
    mkdir -p "$state/root/glassbox"
    printf '{"name":"glassbox","version":"%s"}' "$v" > "$state/root/glassbox/package.json"
    ;;
  root)
    echo "$state/root"
    ;;
  *)
    echo "fake npm: unexpected subcommand $1" >&2; exit 2
    ;;
esac
`,
  );
  chmodSync(join(bin, 'npm'), 0o755);
  return bin;
}

function run(version: string, env: Record<string, string> = {}) {
  const state = join(sandbox, 'state');
  mkdirSync(state, { recursive: true });
  const bin = writeFakeNpm(sandbox);
  const r = spawnSync('bash', [SCRIPT, version], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      FAKE_NPM_STATE: state,
      // Keep the real 15-minute budget out of the test suite.
      GLASSBOX_NPM_WAIT_SECS: '5',
      GLASSBOX_NPM_POLL_SECS: '0',
      ...env,
    },
  });
  let calls: string[] = [];
  try { calls = readFileSync(join(state, 'calls.log'), 'utf8').trim().split('\n'); } catch { /* no calls */ }
  return { ...r, calls };
}

beforeEach(() => { sandbox = mkdtempSync(join(tmpdir(), 'gb-install-published-')); });
afterEach(() => { rmSync(sandbox, { recursive: true, force: true }); });

describe('install-published.sh', () => {
  it('requires a version argument', () => {
    const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('usage');
  });

  it('keeps probing the registry until the version is visible, then installs it', () => {
    const r = run('1.2.1-rc.1', { FAKE_NPM_VISIBLE_AFTER: '3' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.filter((c) => c.startsWith('view glassbox@1.2.1-rc.1'))).toHaveLength(3);
    expect(r.calls.filter((c) => c.startsWith('install'))).toHaveLength(1);
    expect(r.stdout).toContain('not yet visible');
    expect(r.stdout).toContain('Installed glassbox@1.2.1-rc.1');
  });

  it('probes with a fresh cache so a stale packument cannot answer for the registry', () => {
    const r = run('1.2.1-rc.1');
    const view = r.calls.find((c) => c.startsWith('view'));
    expect(view).toMatch(/--cache \S+/);
  });

  it('fails without installing when the version never appears within the budget', () => {
    const r = run('9.9.9', { FAKE_NPM_VISIBLE_AFTER: '1000000', GLASSBOX_NPM_WAIT_SECS: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not visible on the npm registry');
    expect(r.calls.some((c) => c.startsWith('install'))).toBe(false);
  });

  it('retries a failing install and succeeds once the tarball is fetchable', () => {
    const r = run('1.2.1-rc.1', { FAKE_NPM_INSTALL_FAIL_TIMES: '2' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.calls.filter((c) => c.startsWith('install'))).toHaveLength(3);
    expect(r.stdout).toContain('install attempt 1 failed');
  });

  it('gives up after the configured install attempts', () => {
    const r = run('1.2.1-rc.1', { FAKE_NPM_INSTALL_FAIL_TIMES: '99', GLASSBOX_NPM_INSTALL_ATTEMPTS: '3' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('failed 3 times');
    expect(r.calls.filter((c) => c.startsWith('install'))).toHaveLength(3);
  });

  // The regression that motivated the script: the old loop let the upgrade
  // smoke run against the previously installed stable and report green.
  it('fails when the installed package is not the requested version', () => {
    const r = run('1.2.1-rc.1', { FAKE_NPM_INSTALLED_VERSION: '1.1.2' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("installed glassbox is '1.1.2', expected '1.2.1-rc.1'");
  });

  it('fails when nothing is installed at all', () => {
    const r = run('1.2.1-rc.1', { FAKE_NPM_INSTALL_NOOP: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("installed glassbox is '<none>', expected '1.2.1-rc.1'");
  });
});
