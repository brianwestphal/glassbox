/**
 * The **Apple Foundation Models** (on-device Apple Intelligence) provider bridge
 * — docs/22 §22.3, the P2 counterpart to the cloud platforms and the `local`
 * OpenAI-compatible provider.
 *
 * Apple's on-device LLM is only reachable from native macOS (Swift
 * `FoundationModels`), which the Node server can't call directly. So the server
 * shells out to a tiny bundled **Swift CLI helper**
 * (`src-tauri/apple-fm-helper/main.swift`): `--probe` reports availability, and
 * `--infer` reads `{system, messages}` JSON on stdin and writes `{content}` JSON
 * on stdout — the model's raw text, which the existing `extractJSON` parses just
 * like the cloud responses. Because the *server* runs it, all analysis modes
 * (risk / narrative / guided) work with no per-mode change.
 *
 * Resolution: the bundled-binary path comes from `GLASSBOX_APPLE_FM_BIN` (set by
 * the Tauri launcher / build), with a `cwd` fallback. On non-darwin, a missing
 * binary, or a failing probe, the provider reports unavailable and the platform
 * simply doesn't appear. Everything here is pure Node and unit-tested with an
 * injected runner; the Swift helper and the end-to-end on-device path can only
 * be verified on real macOS-26 hardware with Apple Intelligence.
 */
import { spawn } from 'node:child_process';

import { existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

/** Spawn a process, write `stdin`, resolve with its stdout + exit code. */
export type ProcessRunner = (bin: string, args: string[], stdin: string) => Promise<{ stdout: string; code: number }>;

const defaultRunner: ProcessRunner = (bin, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => { resolve({ stdout, code: code ?? 0 }); });
    child.stdin.end(stdin);
  });

let runner: ProcessRunner = defaultRunner;
/** Apple Foundation Models are macOS-only; injectable so the availability matrix
 *  is testable on Linux CI. */
let isDarwin: boolean = process.platform === 'darwin';
/** Cached availability — the OS-model state changes rarely within a session. */
let availabilityCache: boolean | null = null;

/** Absolute path to the bundled Swift helper, or null when it isn't present. */
export function appleFmBinPath(): string | null {
  const env = process.env.GLASSBOX_APPLE_FM_BIN;
  if (env !== undefined && env !== '' && existsSync(env)) return env;
  const fallback = join(process.cwd(), 'apple-fm-helper');
  if (existsSync(fallback)) return fallback;
  return null;
}

/**
 * Whether on-device Apple Foundation Models can be used right now: macOS, the
 * helper binary present, and its `--probe` reporting `available` (macOS 26 +
 * Apple Intelligence enabled + model downloaded). Cached after the first check.
 */
export async function isAppleFoundationAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  availabilityCache = await probeAvailability();
  return availabilityCache;
}

async function probeAvailability(): Promise<boolean> {
  if (!isDarwin) return false;
  const bin = appleFmBinPath();
  if (bin === null) return false;
  try {
    const { stdout, code } = await runner(bin, ['--probe'], '');
    return code === 0 && stdout.trim().toLowerCase().startsWith('available');
  } catch {
    return false;
  }
}

/** The wire shape the helper writes on stdout for `--infer`. */
const InferOutputSchema = z.object({ content: z.string() });

interface AppleMessage { role: 'user' | 'assistant'; content: string }

/**
 * Run one on-device inference. Sends `{system, messages}` to the helper and
 * returns the model's raw text response (the caller's `extractJSON` parses it,
 * exactly as for the cloud providers). Throws if the helper is missing, exits
 * non-zero, or writes a malformed payload.
 */
export async function runAppleFoundationInfer(system: string, messages: AppleMessage[]): Promise<string> {
  const bin = appleFmBinPath();
  if (bin === null) throw new Error('Apple Foundation Models helper not found');
  const { stdout, code } = await runner(bin, ['--infer'], JSON.stringify({ system, messages }));
  if (code !== 0) throw new Error(`Apple Foundation Models helper exited with code ${String(code)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error('Apple Foundation Models helper returned non-JSON output');
  }
  const parsed = InferOutputSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Apple Foundation Models helper returned an unexpected payload');
  return parsed.data.content;
}

/** **TEST ONLY** — inject a fake process runner + pretend-platform. */
export function _setAppleFoundationForTesting(opts: { runner?: ProcessRunner; darwin?: boolean }): void {
  if (opts.runner !== undefined) runner = opts.runner;
  if (opts.darwin !== undefined) isDarwin = opts.darwin;
  availabilityCache = null;
}

/** **TEST ONLY** — clear the availability cache + restore real wiring. */
export function _resetAppleFoundationForTesting(): void {
  runner = defaultRunner;
  isDarwin = process.platform === 'darwin';
  availabilityCache = null;
}
