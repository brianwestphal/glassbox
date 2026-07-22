/**
 * Install an opt-in bundled plugin from the UI (doc 29 §29.2, GB-1069). This is
 * the "click Install → check readiness → auto-fix what we can, else instruct"
 * action the maintainer asked for:
 *
 *   1. copy the plugin folder out of the sidecar bundle into `~/.glassbox/plugins/`
 *      (self-contained plugins are done here — nothing else to do);
 *   2. check the manifest's system requirements (a JRE, `npm`, …);
 *   3. run the auto-fixable provisioning steps whose prerequisites are met
 *      (`fetch` a file — always runnable; `npm-install` — only if `npm` is present);
 *   4. return a structured result: what installed, which requirements are unmet,
 *      which steps were skipped, and the exact instructions to finish by hand.
 *
 * Every external effect (spawn, fetch) is injectable so the whole flow is
 * unit-testable without a network or a real toolchain.
 */
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { cpSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { bundledPluginsDir, discoverBundledPlugins, undismissPlugin } from './install.js';
import { pluginsDir } from './loader.js';
import type { PluginManifest, PluginProvisionStep } from './manifest.js';
import { checkRequirements, type CommandProbe, requirementMet, type RequirementStatus } from './readiness.js';

/** Outcome of one provisioning step. */
export interface ProvisionOutcome {
  step: string;
  ok: boolean;
  /** True when the step was skipped because a prerequisite was missing. */
  skipped: boolean;
  detail: string;
}

/** The result of an install attempt, for the UI. */
export interface InstallResult {
  id: string;
  /** Whether the plugin folder was copied into place. */
  installed: boolean;
  /** `ready` = usable now; `needs-setup` = installed but requires manual steps;
   *  `error` = couldn't install (e.g. not a bundled opt-in plugin). */
  status: 'ready' | 'needs-setup' | 'error';
  requirements: RequirementStatus[];
  provisioned: ProvisionOutcome[];
  /** Specific, ordered instructions for the user to finish (empty when ready). */
  instructions: string[];
  error?: string;
}

/** Downloads a URL's bytes. Injectable for tests. */
export type FetchBytes = (url: string) => Promise<Uint8Array>;
/** Runs `npm install <packages>` into `dir`. Injectable for tests. */
export type RunNpmInstall = (dir: string, packages: string[]) => { ok: boolean; detail: string };

const defaultFetchBytes: FetchBytes = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  return new Uint8Array(await res.arrayBuffer());
};

const defaultRunNpmInstall: RunNpmInstall = (dir, packages) => {
  const r = spawnSync('npm', ['install', '--no-save', '--prefix', dir, ...packages], { stdio: 'ignore', timeout: 600_000 });
  if (r.error !== undefined) return { ok: false, detail: r.error.message };
  if (r.status !== 0) return { ok: false, detail: `npm exited ${String(r.status)}` };
  return { ok: true, detail: 'installed' };
};

interface InstallDeps {
  bundledDir?: string;
  userDir?: string;
  runProbe?: CommandProbe;
  fetchBytes?: FetchBytes;
  runNpmInstall?: RunNpmInstall;
}

/** Run one provisioning step, returning its outcome (never throws). */
async function runProvisionStep(
  step: PluginProvisionStep,
  installDir: string,
  requirements: RequirementStatus[],
  deps: Required<Pick<InstallDeps, 'fetchBytes' | 'runNpmInstall'>>,
): Promise<ProvisionOutcome> {
  if (step.kind === 'fetch') {
    const label = `Download ${step.dest}`;
    try {
      const bytes = await deps.fetchBytes(step.url);
      if (step.sha256 !== undefined) {
        const got = createHash('sha256').update(bytes).digest('hex');
        if (got.toLowerCase() !== step.sha256.toLowerCase()) {
          return { step: label, ok: false, skipped: false, detail: `checksum mismatch (expected ${step.sha256})` };
        }
      }
      writeFileSync(join(installDir, step.dest), bytes);
      return { step: label, ok: true, skipped: false, detail: `saved ${step.dest}` };
    } catch (e) {
      return { step: label, ok: false, skipped: false, detail: e instanceof Error ? e.message : 'download failed' };
    }
  }
  // npm-install
  const label = `Install ${step.packages.join(', ')}`;
  const reqId = step.requires ?? 'npm';
  if (!requirementMet(requirements, reqId)) {
    return { step: label, ok: false, skipped: true, detail: `${reqId} is not available` };
  }
  const r = deps.runNpmInstall(installDir, step.packages);
  return { step: label, ok: r.ok, skipped: false, detail: r.detail };
}

/** Build the user-facing instruction list from unmet requirements + failed/skipped steps. */
function buildInstructions(manifest: PluginManifest, requirements: RequirementStatus[], provisioned: ProvisionOutcome[]): string[] {
  const out: string[] = [];
  for (const r of requirements) if (!r.met) out.push(`${r.label}: ${r.hint}`);
  for (const p of provisioned) {
    if (p.ok) continue;
    out.push(p.skipped ? `${p.step} was skipped — ${p.detail}.` : `${p.step} failed — ${p.detail}.`);
  }
  const cliHint = manifest.install?.cliHint;
  if (out.length > 0 && cliHint !== undefined && cliHint !== '') out.push(`Or finish from a terminal: ${cliHint}`);
  return out;
}

/**
 * Install the opt-in bundled plugin `id`. Copies the bundle, checks readiness,
 * auto-runs the provisioning steps it can, and returns what remains. Idempotent:
 * re-running after the user satisfies a requirement completes the missing steps.
 */
export async function installAvailablePlugin(id: string, deps: InstallDeps = {}): Promise<InstallResult> {
  const bundledDir = deps.bundledDir ?? bundledPluginsDir();
  const userDir = deps.userDir ?? pluginsDir();
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const runNpmInstall = deps.runNpmInstall ?? defaultRunNpmInstall;

  const bundled = discoverBundledPlugins(bundledDir).find((b) => b.manifest.id === id);
  if (bundled === undefined) {
    return { id, installed: false, status: 'error', requirements: [], provisioned: [], instructions: [], error: 'Not a bundled plugin available to install.' };
  }
  const manifest = bundled.manifest;

  // 1. Copy the bundle into the user plugins dir (and un-dismiss it, so a prior
  //    uninstall of this bundled plugin doesn't fight the install).
  const dest = join(userDir, id);
  try {
    mkdirSync(userDir, { recursive: true });
    // Preserve an existing install's provisioned assets (e.g. a fetched jar / an
    // installed node_modules) across a re-install: copy the bundle over it
    // without deleting first, so re-running to finish setup is non-destructive.
    cpSync(bundled.dir, dest, { recursive: true });
    undismissPlugin(id, userDir);
  } catch (e) {
    return { id, installed: false, status: 'error', requirements: [], provisioned: [], instructions: [], error: e instanceof Error ? e.message : 'Copy failed.' };
  }

  // 2. Check requirements.
  const requirements = checkRequirements(manifest.install?.requirements, deps.runProbe);

  // 3. Run the provisioning steps we can.
  const provisioned: ProvisionOutcome[] = [];
  for (const step of manifest.install?.provision ?? []) {
    provisioned.push(await runProvisionStep(step, dest, requirements, { fetchBytes, runNpmInstall }));
  }

  // 4. Assemble the result.
  const instructions = buildInstructions(manifest, requirements, provisioned);
  const status = instructions.length === 0 ? 'ready' : 'needs-setup';
  return { id, installed: true, status, requirements, provisioned, instructions };
}
