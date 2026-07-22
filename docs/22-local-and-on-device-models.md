# 22. Local and On-Device AI Models

Requirements for running Glassbox's AI analysis against **local** models (an
OpenAI-compatible server such as Ollama or LM Studio) and **Apple Foundation
Models** (on-device Apple Intelligence), in addition to the existing cloud
providers (Anthropic / OpenAI / Google).

> **Status: Built & verified on-device.** **P1 (the `local` OpenAI-compatible
> platform) is shipped.** **P2 (Apple Foundation Models) is shipped, and now
> delegates to the [`apple-fm`](https://github.com/brianwestphal/apple-fm)
> package** instead of a Glassbox-maintained Swift helper: the `apple` platform,
> the Node bridge (`src/ai/apple-foundation.ts`, a thin wrapper over `apple-fm`'s
> `probe` / `generate`), availability gating, and the settings UI all landed; the
> Node side is unit-tested against a mocked `apple-fm`. `apple-fm` ships a tested
> Node library over its own Developer-ID **signed + notarized** helper binary —
> so Glassbox no longer compiles, signs, or notarizes a Swift helper itself, and
> the dedicated macOS-26 CI compile job is gone. The on-device path was previously
> verified end-to-end on macOS 26 with Apple Intelligence (probe → on-device
> inference → the `{content}` text the analysis parser consumes); the `apple-fm`
> migration keeps the same `{system,messages}` → text contract.
>
> **Production bundling (§22.9):** `build-sidecar.sh` copies the `apple-fm`
> package (helper included) into the sidecar; the helper's embedded
> signature survives, so `tauri-action`'s notarization of the whole bundle covers
> it. The remaining step is the maintainer's distribution smoke test on a clean
> macOS-26 machine — the on-device run + Gatekeeper/notarization acceptance of the
> bundled helper can only be verified on real macOS-26 hardware with Apple
> Intelligence.
>
> **Apple FM's 4096-token context window can't fit the risk-analysis prompt +
> output for larger diffs** (on-device testing showed non-deterministic
> `exceededContextWindowSize` failures, and the ceiling isn't removable by prompt
> trimming). Rather than gate the platform off, **selecting Apple lets the user
> choose a secondary non-Apple fallback model**: each batch runs on-device and
> any batch that fails spills to the fallback (`AIConfig.fallback`, applied
> per-batch in `runAnalysisBatch`). `APPLE_FM_ANALYSIS_ENABLED` (`src/ai/models.ts`)
> remains the platform kill-switch. See **§22.10**.
> `apple-fm` itself originated from the same on-device approach used in the sibling
> Hot Sheet app's "Announcer" feature, extracted into a reusable, separately
> signed + notarized package.

## Motivation

Cloud AI requires an API key, costs money per review, and sends diffs to a
third party. Local and on-device models are **free, private, and offline**: the
code never leaves the machine. Ollama and other OpenAI-compatible servers are
common developer setups; Apple Foundation Models ship with macOS for free.

## Functional Requirements

### 22.1 Two new platforms

- The AI-platform set (`AIPlatform` in `src/ai/models.ts`) shall gain two
  members: **`local`** and **`apple`**. They plug into the same abstraction the
  three cloud platforms use — `sendAIRequest`'s `switch` (`src/ai/client.ts`),
  the config (`src/ai/config.ts`), model discovery (`src/ai/list-models.ts`),
  and the settings platform picker — so all AI analysis modes (risk / narrative
  / guided) work against them with no per-mode changes.
- Neither platform requires an API key. The current "no key → unavailable" gate
  (`sendAIRequest` throws when `apiKey === null`; the sort-mode UI prompts for a
  key) shall treat `local`/`apple` as available based on their own checks, not
  on a key.

### 22.2 Local OpenAI-compatible models

- **Request** — Local analysis shall POST to `{baseUrl}/chat/completions` with
  the OpenAI Chat Completions body (the existing `sendOpenAIRequest` shape),
  optionally with `Authorization: Bearer <key>` when a key is configured (some
  OpenAI-compatible servers require one; Ollama does not).
- **Base URL** — Configurable, persisted in `~/.glassbox/config.json`,
  defaulting to Ollama's **`http://localhost:11434/v1`**. Trailing slashes
  trimmed.
- **Model discovery** — The model list shall come from `GET {baseUrl}/models`
  (the OpenAI list shape `{ data: [{ id }] }`), reusing the live-discovery
  machinery added for the cloud providers. Availability = endpoint reachable AND
  ≥ 1 model returned. The probe is **fetched live on each request** (no cache) —
  a local server can start/stop mid-session, and the settings dialog is the only
  caller, so freshness beats caching here. (An earlier draft specified a
  short-TTL cache; the uncached implementation is intentional.)
- **Context window** — Unknown for arbitrary local models; batch planning shall
  use a conservative default.

### 22.3 Apple Foundation Models (on-device)

- **Mechanism** — Delegated to the [`apple-fm`](https://github.com/brianwestphal/apple-fm)
  package, a tested, zero-runtime-dependency Node library over a native **Swift
  helper** (`FoundationModels` framework, macOS 26+) that `apple-fm` bundles and
  spawns. `src/ai/apple-foundation.ts` calls `apple-fm`'s `generate({ system,
  messages })` and returns the model's text. (HTTP isn't applicable — the model
  is reached through a Swift API, not a server.) Glassbox no longer ships its own
  Swift helper or build script.
- **Availability** — `isAppleFoundationAvailable()` gates on `apple-fm`'s
  `isPlatformSupported()` (macOS on Apple Silicon) then `probe()` (macOS 26 +
  Apple Intelligence enabled + model downloaded), cached per session; any failure
  → unavailable. `apple-fm` resolves its helper binary via the `APPLE_FM_BIN` env
  var, then its bundled `bin/apple-fm-helper`, then `PATH`.
- **Build & bundle** — Nothing to compile: `apple-fm` ships a prebuilt,
  Developer-ID **signed + notarized** arm64 helper. `build-sidecar.sh` copies the
  `apple-fm` package (helper included) into the sidecar's `node_modules` like any
  other external dep, and the Tauri launcher points `APPLE_FM_BIN` at
  `server/node_modules/apple-fm/bin/apple-fm-helper`. The bundled helper's
  embedded signature survives into the app bundle, so `tauri-action`'s
  notarization covers it (§22.9) — codesign needs no macOS-26 SDK, so the bundle
  build stays on macOS 15. In **dev** (`tauri:dev`) the Node server runs from
  source and `apple-fm` resolves its bundled helper straight from the project's
  `node_modules`, so the Apple platform appears in dev on a capable machine with
  no extra wiring.
- **Structured output caveat** — Risk/narrative analysis expects the model to
  return JSON the analysis parser extracts. The helper must therefore produce
  parseable output — either Apple's guided generation constrained to Glassbox's
  schema, or a JSON-instructed prompt whose text the existing `extractJSON`
  handles. Small on-device (and small local) models may produce lower-quality
  or malformed structured output; failures degrade gracefully (the analysis
  surfaces an error, the rest of Glassbox is unaffected).

### 22.4 Settings UX

- The Experimental tab's platform picker shall include **Local** and **Apple**.
  **Apple** is shown only when available (helper present and the on-device model
  usable) — an unavailable on-device platform is not actionable. **Local** is
  always shown: the user must be able to select it *before* the endpoint is
  reachable (picking Local is how you reveal the base-URL field to point at a
  server you're about to start), so gating it on reachability would be a
  chicken-and-egg. Reachability problems surface in the model dropdown instead.
- Selecting **Local** reveals a **base-URL input** (default
  `http://localhost:11434/v1`) and a **model dropdown** populated from
  discovery; the API-key field is hidden (or shown as optional). A
  stored-but-currently-absent model name stays selectable rather than being
  silently dropped.
- Selecting **Apple** needs neither key nor endpoint; it shows the on-device
  model and an availability/status hint.

## Non-Functional Requirements

### 22.5 Privacy & resilience

- Local and Apple analysis shall make **no network calls off the machine** —
  local hits only the configured (loopback by default) endpoint; Apple is fully
  on-device.
- Unavailability (server down, wrong URL, no Apple Intelligence, non-macOS) is a
  normal state: the platform simply doesn't appear / reports unavailable; it
  never crashes the app.

### 22.6 Testability

- The local provider shall be **hermetically unit-testable** by injecting
  `fetch` (request shape, discovery parsing, availability, fallback) — same as
  the cloud live-discovery tests.
- The Apple bridge shall be unit-testable by mocking the `apple-fm` module
  (`probe` / `generate` / `isPlatformSupported`). The **on-device helper itself
  and the end-to-end on-device path can only be verified on real macOS-26
  hardware with Apple Intelligence** — out of scope for CI / this environment;
  `apple-fm` smoke-verifies its own helper independently.

## 22.7 Cross-platform support

- Local works on any OS (it's HTTP). Apple Foundation Models are **macOS-only**
  and the helper no-ops elsewhere; the platform is simply absent on other OSes.

## 22.8 Phasing

- **P1 — Local OpenAI-compatible provider.** *(shipped)* The tractable,
  reference-proven, hermetically-testable slice: the `local` platform
  (`KEYLESS_PLATFORMS` in `src/ai/models.ts`), base-URL config
  (`resolveLocalEndpoint`, default Ollama; `src/ai/config.ts`), OpenAI request
  reuse against the base URL (`sendLocalRequest`; `src/ai/client.ts`), `/models`
  discovery (`fetchAvailableModels('local', …)`; `src/ai/list-models.ts`), and
  the settings UX (server-URL input + optional key; `experimentalTab.tsx`).
  Delivers free/offline review on its own.
- **P2 — Apple Foundation Models.** *(shipped)* The `apple` platform
  (`KEYLESS_PLATFORMS`, `MODELS.apple`, `APPLE_ON_DEVICE_MODEL_ID` in
  `src/ai/models.ts`), the Node bridge (`src/ai/apple-foundation.ts` — a thin
  wrapper over the `apple-fm` package's `probe` / `generate`, platform-gated
  cached availability), the client `apple` case (`sendAppleRequest`;
  `src/ai/client.ts`, `{system,messages}` → text the existing `extractJSON`
  parses), and the settings UI (Apple shown only when the probe passes; no
  key/endpoint). The Node side is hermetically unit-tested against a mocked
  `apple-fm`; the structured output uses the JSON-instructed-prompt path (§22.3).
- **P2a — Apple FM production signing + notarization.** *(shipped — see §22.9)*
  Migrated to the `apple-fm` package, which ships its own Developer-ID signed +
  notarized helper, so Glassbox no longer compiles, signs, or notarizes a Swift
  helper and the dedicated macOS-26 CI job is gone. `build-sidecar.sh` bundles the
  package (helper included) and `tauri-action` notarizes the whole bundle. The
  only remaining item is the maintainer's distribution smoke test on a clean
  macOS-26 machine (Apple Intelligence hardware) confirming the bundled helper
  runs and passes Gatekeeper.

## 22.9 Production signing & notarization (P2a)

The on-device helper is a native arm64 Mach-O shipped **inside the `apple-fm`
npm package** (`node_modules/apple-fm/bin/apple-fm-helper`), already Developer-ID
signed with hardened runtime **and independently notarized** by `apple-fm`.
`build-sidecar.sh` copies the `apple-fm` package into the sidecar's
`node_modules` like any other external dep, so the helper rides along; the Tauri
launcher points `APPLE_FM_BIN` at `server/node_modules/apple-fm/bin/apple-fm-helper`.

This collapses the prior dedicated-job complexity:

- **No macOS-26 CI job, no Swift compile.** Glassbox no longer compiles a helper,
  so there is no `swiftc`/macOS-26-SDK dependency in CI. The entire
  `build-apple-fm-helper` job (and the `scripts/ci/apple-fm-signing-keychain.sh`
  isolated-keychain provisioning) is removed from both `release-desktop.yml` and
  `release-candidate.yml`. The bundle build stays on the proven **macOS 15** image.
- **Notarization covers the bundled helper.** Apple's notary service accepts a
  nested Mach-O that is Developer-ID signed with hardened runtime (the team need
  not match the outer app). `apple-fm`'s helper already satisfies that, and its
  embedded signature survives the package copy into the bundle, so `tauri-action`'s
  notarization of the whole app covers it.
- **Optional belt-and-braces re-sign.** When a signing identity is available
  (`APPLE_SIGNING_IDENTITY` / `CODESIGN_IDENTITY`, e.g. the maintainer's local
  `tauri:build:local` on macOS), `build-sidecar.sh` re-signs the bundled helper
  with that identity + hardened runtime so the bundle's signature is
  self-consistent. In CI the identity isn't passed to the sidecar step, so the
  helper keeps `apple-fm`'s own valid signature.
- **Gating composes with this:** on a non-macOS / non-arm64 install the bundled
  helper simply never runs (`apple-fm`'s `probe` reports `unsupportedPlatform`),
  `isAppleFoundationAvailable()` returns false, and the settings UI omits the
  Apple platform — so it's never listed where it can't run.
- **Verification (maintainer):** cut a **beta** first (its signed build exercises
  this path → prerelease, no `latest` flip), then on a clean (non-build) macOS-26
  machine install the signed + notarized bundle and confirm the bundled helper
  probes `available` and runs inference with no quarantine/Gatekeeper rejection,
  before a stable cut relies on it. This is the one step that can't be verified in
  CI or off-device.

## 22.10 Apple FM small context window — the secondary fallback model

On-device testing on macOS 26 confirmed the Apple Foundation Models system model
has a **hard 4096-token context window shared by input and output**. Glassbox's
risk-analysis prompt asks for verbose per-file JSON (six dimension scores +
rationale + overview + per-line notes), and that output competes with the diff
input for the same 4096 tokens. In real tests a single ~30-line file overflowed
(`exceededContextWindowSize`, after a ~64 s hang) while larger 50–80-line files
happened to fit, because failure is driven by how verbose the *generated* output
gets — so identical reviews can randomly succeed or fail. Crucially this **isn't
fixable by prompt trimming**: a single file whose diff alone exceeds the window
(~150–200 changed lines) can never be scored in one shot, because the model must
see the whole diff to assess it.

So rather than gate Apple FM off, **selecting `apple` lets the user pick a
secondary, non-Apple fallback model**, and analysis spills to it **per failed
batch**:

- `APPLE_FM_ANALYSIS_ENABLED = true` in `src/ai/models.ts` is the platform's
  kill-switch (flip to `false` to remove it entirely; `loadAIConfig` then maps a
  saved `apple` preference to the cloud default).
- The fallback selection (`fallbackPlatform` / `fallbackModel`) is stored in
  `~/.glassbox/config.json`. `loadAIConfig()` resolves it into a nested
  `AIConfig.fallback` (its own model + API key + base URL) **only when the
  primary is `apple`** and the selection is valid + non-apple. One level deep —
  the fallback never has its own `.fallback`.
- `runAnalysisBatch` (shared by risk / narrative / guided) runs each batch
  on-device; on **any** failure (context overflow, helper error, malformed
  output) it retries that batch once with `config.fallback`, **rebuilding the
  diff contexts against the fallback's larger window** so they aren't
  pre-truncated to 4096. If both fail, the batch degrades gracefully (those
  files get no scores), as before.
- Settings (Experimental tab): when Apple is selected, a "Fallback model"
  section offers a platform select (excluding apple) + model select + that
  platform's API-key entry (a cloud fallback needs its own key). "None" skips
  oversized files instead.

**Trade-off (accepted):** because only the oversized batches spill, a review's
risk scores can come from two models (two scoring scales). This maximizes
on-device (free/private) coverage; whole-review consistency was the rejected
alternative. The `4096` constant in `models.ts` is correct — the task is what
doesn't fit, which is exactly what the fallback absorbs.

The Apple on-device path itself stays **CI-unverifiable** (no macOS-26 helper on
the hosted runners; the integration tests mock availability), so the
fallback-driven Apple UI is verified on real hardware by the maintainer; the
fallback config + execution logic are covered by unit + integration tests.

## Maintenance triggers

Update this document when: a platform id, default endpoint, or config key
changes; the Apple helper's I/O protocol or build/bundle approach changes; the
settings UX for keyless providers changes; the structured-output handling for
local/on-device models changes; or Apple FM analysis is re-enabled
(`APPLE_FM_ANALYSIS_ENABLED`). When a phase ships, update its status here and
in `docs/ai/requirements-summary.md`.
