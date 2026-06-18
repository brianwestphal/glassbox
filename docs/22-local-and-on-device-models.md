# 22. Local and On-Device AI Models

Requirements for running Glassbox's AI analysis against **local** models (an
OpenAI-compatible server such as Ollama or LM Studio) and **Apple Foundation
Models** (on-device Apple Intelligence), in addition to the existing cloud
providers (Anthropic / OpenAI / Google).

> **Status: Partially built.** **P1 (the `local` OpenAI-compatible platform) is
> shipped.** Apple Foundation Models (P2) remain design-only. Phasing is in
> §22.8. A working reference exists in the sibling Hot Sheet app's "Announcer"
> feature (`src/announcer/localProvider.ts`, `src/announcer/appleFoundation.ts`,
> `src-tauri/apple-fm-helper/main.swift`, `scripts/build-apple-fm-helper.sh`) —
> this doc adapts that approach to Glassbox's AI-platform abstraction.

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
  *(Hot Sheet shipped the dev path and left production bundling + code-signing
  as follow-up — Glassbox should budget for the same.)*
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
- **P2 — Apple Foundation Models.** The Swift helper + Node bridge + build
  script + Tauri bundling + availability gating + the structured-output
  handling. Native, macOS-26-only, verifiable only on real hardware.
- **P2a — Apple FM production bundling & code-signing.** May split out, mirroring
  Hot Sheet's dev-first / prod-follow-up sequencing.

## Maintenance triggers

Update this document when: a platform id, default endpoint, or config key
changes; the Apple helper's I/O protocol or build/bundle approach changes; the
settings UX for keyless providers changes; or the structured-output handling for
local/on-device models changes. When a phase ships, update its status here and
in `docs/ai/requirements-summary.md`.
