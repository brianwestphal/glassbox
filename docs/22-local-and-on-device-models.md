# 22. Local and On-Device AI Models

Requirements for running Glassbox's AI analysis against **local** models (an
OpenAI-compatible server such as Ollama or LM Studio) and **Apple Foundation
Models** (on-device Apple Intelligence), in addition to the existing cloud
providers (Anthropic / OpenAI / Google).

> **Status: Built & verified on-device.** **P1 (the `local` OpenAI-compatible
> platform) is shipped.** **P2 (Apple Foundation Models) is shipped:** the
> `apple` platform, the Node bridge (`src/ai/apple-foundation.ts`), the Swift
> helper (`src-tauri/apple-fm-helper/main.swift`), the guarded + code-signing
> build script (`scripts/build-apple-fm-helper.sh`), bundling, availability
> gating, and the settings UI all landed; the Node side is unit-tested. The full
> path was **verified end-to-end on macOS 26 with Apple Intelligence**: the Swift
> helper compiles, `--probe` reports `available`, `--infer` runs real on-device
> inference returning the `{content}` JSON the analysis parser consumes, the Node
> bridge + `sendAIRequest({platform:'apple'})` drive it, and the helper signs
> with hardened runtime. **P2a (production signing + notarization wiring) is
> shipped:** the release workflows now sign the helper with the real Developer ID
> + hardened runtime before `tauri-action` notarizes the bundle (§22.9). The
> remaining step is the maintainer's distribution smoke test on a clean macOS-26
> machine, plus — until GitHub's hosted runners ship a macOS 26 / Xcode 26 image
> — CI compiles the helper only on a capable runner (the maintainer's local
> `tauri:build:local` on macOS 26 already produces a signed, notarizable helper).
> A working reference exists in the
> sibling Hot Sheet app's "Announcer" feature (`src/announcer/localProvider.ts`,
> `src/announcer/appleFoundation.ts`, `src-tauri/apple-fm-helper/main.swift`,
> `scripts/build-apple-fm-helper.sh`) — this doc adapts that approach to
> Glassbox's AI-platform abstraction.

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
  ≥ 1 model returned. Probe result cached with a **short TTL** (a local server
  can start/stop mid-session), unlike the cloud lists.
- **Context window** — Unknown for arbitrary local models; batch planning shall
  use a conservative default.

### 22.3 Apple Foundation Models (on-device)

- **Mechanism** — A native **Swift helper** (`FoundationModels` framework,
  macOS 26+) is bridged from Node via `child_process.spawn` with a stdin/stdout
  **JSON protocol**: `--probe` prints `available`/`unavailable`; an inference
  subcommand reads `{ system, messages }` on stdin and writes the model's
  response as JSON on stdout. (HTTP isn't applicable — the model is reached
  through a Swift API, not a server.)
- **Availability** — Detected by spawning the helper with `--probe` (gated to
  macOS; cached per session). The helper resolves via an env var
  (`GLASSBOX_APPLE_FM_BIN`) else a known path; absent → unavailable.
- **Build & bundle** — Compiled by a **guarded** `swiftc` build script
  (no-op on non-macOS / missing `swiftc` / missing macOS-26 SDK) and shipped as
  a Tauri resource; the launcher sets the bin env var for the packaged server.
  Because it lands under Tauri `resources/**` (not as an `externalBin`), Tauri
  does **not** sign it — so the build script signs it with the Developer ID +
  hardened runtime before the bundle is notarized (§22.9).
- **Structured output caveat** — Risk/narrative analysis expects the model to
  return JSON the analysis parser extracts. The helper must therefore produce
  parseable output — either Apple's guided generation constrained to Glassbox's
  schema, or a JSON-instructed prompt whose text the existing `extractJSON`
  handles. Small on-device (and small local) models may produce lower-quality
  or malformed structured output; failures degrade gracefully (the analysis
  surfaces an error, the rest of Glassbox is unaffected).

### 22.4 Settings UX

- The Experimental tab's platform picker shall include **Local** and **Apple**,
  each shown **only when available** (local endpoint reachable; Apple helper
  present and the model available).
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
- The Apple helper's Node bridge shall be unit-testable by injecting the process
  runner (probe/inference protocol). The **Swift helper itself and the
  end-to-end on-device path can only be verified on real macOS-26 hardware with
  Apple Intelligence** — out of scope for CI / this environment.

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
- **P2 — Apple Foundation Models.** *(shipped, dev-first)* The `apple` platform
  (`KEYLESS_PLATFORMS`, `MODELS.apple`, `APPLE_ON_DEVICE_MODEL_ID` in
  `src/ai/models.ts`), the Node bridge (`src/ai/apple-foundation.ts` — `--probe`
  / `--infer` protocol over `spawn`, injected runner, darwin-gated cached
  availability, bin resolved via `GLASSBOX_APPLE_FM_BIN`), the client `apple`
  case (`sendAppleRequest`; `src/ai/client.ts`), the Swift helper
  (`src-tauri/apple-fm-helper/main.swift`, `{system,messages}` → `{content}`
  text the existing `extractJSON` parses), the guarded + signed build script
  (`scripts/build-apple-fm-helper.sh`, wired into `build-sidecar.sh`), bundling
  as a `server/` resource + the launcher's `GLASSBOX_APPLE_FM_BIN` export, and
  the settings UI (Apple shown only when the probe passes; no key/endpoint). The
  Node side is hermetically unit-tested with an injected runner; the structured
  output uses the JSON-instructed-prompt path (§22.3).
- **P2a — Apple FM production signing + notarization in CI.** *(shipped — see
  §22.9)* The compile + on-device run + ad-hoc/hardened-runtime signing were
  verified on macOS-26 hardware. The release workflows now provision the
  Developer ID and sign the helper before notarization. The only remaining item
  is the maintainer's distribution smoke test on a clean macOS-26 machine (needs
  the CI release secrets + Apple Intelligence hardware), plus the standing
  dependency that CI compiles the helper only on a macOS 26 / Xcode 26 runner.

## 22.9 Production signing & notarization (P2a)

The Apple FM helper is a native arm64 Mach-O binary bundled under Tauri
`resources/**` (via `scripts/build-sidecar.sh` → `server/`). Tauri signs the
main app binary and its `externalBin` sidecars (e.g. the Node runtime) with
hardened runtime, but it does **not** sign arbitrary Mach-O files under
`resources/**`. Apple's notary service rejects a bundle containing any unsigned
or non-hardened-runtime Mach-O, so the helper must be signed **before**
`tauri-action` notarizes the app bundle.

The helper compiles only on a **macOS 26 / Xcode 26** toolchain
(`swiftc -target arm64-apple-macos26`), but the app bundle is built on the proven
**macOS 15** image. CI bridges that with a **dedicated helper job**, so only the
small helper touches macOS 26 — the main bundle build is unchanged:

- **`build-apple-fm-helper` job** (`runs-on: macos-26`, in both
  `release-desktop.yml` and the signed beta build in `release-candidate.yml`):
  compiles the helper, signs it with `codesign --options runtime --timestamp`
  (`scripts/build-apple-fm-helper.sh`, using `APPLE_SIGNING_IDENTITY`), verifies
  it was produced, and uploads it as the `apple-fm-helper` artifact. The
  Developer ID is provisioned into an **isolated keychain** by
  `scripts/ci/apple-fm-signing-keychain.sh import` and referenced explicitly via
  `codesign --keychain "$APPLE_FM_KEYCHAIN"`, so the global keychain search list
  is never mutated; a cleanup step deletes it. No-ops without `APPLE_CERTIFICATE`
  (helper built unsigned — dev only, never notarized).
- **Main `build` job** stays on `macos-latest` (macOS 15). The **arm64** shard
  downloads the signed artifact and `build-sidecar.sh` copies it into the bundle
  via `GLASSBOX_PREBUILT_APPLE_FM_HELPER`; the helper's embedded signature
  survives the copy (and the artifact zip round-trip), so `tauri-action`'s
  notarization of the whole bundle covers it. The Intel shard sets no such env
  and omits the helper — Apple Intelligence and the helper are arm64-only, so the
  Intel bundle never carries it (and the app hides the Apple platform there).
- **Local builds** (the maintainer's `tauri:build:local` on a macOS 26 machine)
  leave `GLASSBOX_PREBUILT_APPLE_FM_HELPER` unset, so `build-sidecar.sh` compiles
  + signs the helper inline as before — no artifact needed.
- **Gating composes with this:** any bundle without the helper binary (Intel,
  Linux, Windows, or an arm64 build that didn't get the artifact) reports
  `unavailable` from `isAppleFoundationAvailable()` and the settings UI omits the
  Apple platform — so the platform is never listed where it can't run.
- **Verification (maintainer, → GB-918):** cut a **beta** first (its signed build
  exercises this path → prerelease, no `latest` flip), then on a clean
  (non-build) macOS-26 machine install the signed + notarized bundle and confirm
  the helper probes `available` and runs inference with no quarantine/Gatekeeper
  rejection, before a stable cut relies on it.

## Maintenance triggers

Update this document when: a platform id, default endpoint, or config key
changes; the Apple helper's I/O protocol or build/bundle approach changes; the
settings UX for keyless providers changes; or the structured-output handling for
local/on-device models changes. When a phase ships, update its status here and
in `docs/ai/requirements-summary.md`.
