/**
 * The **Apple Foundation Models** (on-device Apple Intelligence) provider bridge
 * — docs/22 §22.3, the on-device counterpart to the cloud platforms and the
 * `local` OpenAI-compatible provider.
 *
 * Apple's on-device LLM is only reachable from native macOS (Swift
 * `FoundationModels`), which the Node server can't call directly. Rather than
 * ship and maintain our own Swift helper, this delegates to the
 * [`apple-fm`](https://github.com/brianwestphal/apple-fm) package: a tested,
 * zero-runtime-dependency Node library over a bundled, Developer-ID **signed +
 * notarized** Swift helper binary. `apple-fm` locates that helper via the
 * `APPLE_FM_BIN` env var, then the binary bundled inside the package
 * (`bin/apple-fm-helper`), then `apple-fm-helper` on `PATH`. Because the
 * *server* drives it, all analysis modes (risk / narrative / guided) work with
 * no per-mode change.
 *
 * Off-platform (not macOS on Apple Silicon), with the model unavailable, or on a
 * failing probe, the provider reports unavailable and the platform simply
 * doesn't appear. The on-device path can only be verified on real macOS-26
 * hardware with Apple Intelligence; everything here is pure Node and unit-tested
 * against a mocked `apple-fm`.
 */
import { generate, isPlatformSupported, probe } from 'apple-fm';

/** Cached availability — the OS-model state changes rarely within a session. */
let availabilityCache: boolean | null = null;

/**
 * Whether on-device Apple Foundation Models can be used right now: macOS on
 * Apple Silicon, with `apple-fm`'s probe reporting the model available (macOS 26
 * + Apple Intelligence enabled + model downloaded). Cached after the first check.
 */
export async function isAppleFoundationAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  availabilityCache = await probeAvailability();
  return availabilityCache;
}

async function probeAvailability(): Promise<boolean> {
  if (!isPlatformSupported()) return false;
  try {
    const result = await probe();
    return result.available;
  } catch {
    return false;
  }
}

interface AppleMessage { role: 'user' | 'assistant'; content: string }

/**
 * Run one on-device inference. Sends `{system, messages}` to `apple-fm`'s
 * `generate` and returns the model's raw text response (the caller's
 * `extractJSON` parses it, exactly as for the cloud providers). Throws if the
 * helper is missing or the generation fails.
 */
export async function runAppleFoundationInfer(system: string, messages: AppleMessage[]): Promise<string> {
  return generate({ system, messages });
}

/** **TEST ONLY** — clear the cached availability between cases. */
export function _resetAppleFoundationCache(): void {
  availabilityCache = null;
}
