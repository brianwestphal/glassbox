# 31. Plugin Review Lifecycle Hooks

Content plugins (doc [29](29-content-plugins.md)) render specialized content, and
UI-extension plugins (doc [30](30-plugin-ui-extensions.md)) add chrome. This
document covers the first **general (non-content) plugin capability**: a plugin
that reacts to the **review lifecycle** regardless of file type — to run an
analysis, write an artifact, notify an external system, or trigger CI when a
review starts or completes. It is the Glassbox analog of a general integration
backend (cf. the sibling Hot Sheet `TicketingBackend`), scoped to the two events
that matter for a review tool.

The capability is **additive** — it does not touch the renderer/differ contract.
A plugin may register hooks and no content handler at all; the loader already
accepts a content-less registration (doc 29 FR-29.11).

## 31.1 Capability

- **FR-31.1 — Review lifecycle hooks.** A plugin's `activate()` registration
  (`PluginRegistration`, `src/plugins/types.ts`) **may** include a `reviewHooks`
  object with optional `onReviewCreated` and `onReviewCompleted` functions. A
  registration carrying only `reviewHooks` (no `renderers`/`differs`) is valid and
  loads normally. The capability is gated by the same feature flag + enablement
  model as the rest of the plugin subsystem — a disabled plugin's hooks never
  fire.

## 31.2 Hook data

- **FR-31.2 — Stable plugin-facing shapes.** Hooks receive **curated, stable
  shapes**, not raw DB rows, so the contract doesn't leak schema details:
  - **`ReviewHookInfo`** — `id`, `repoPath`, `repoName`, `mode`, `status`.
  - **`AnnotationHookInfo`** — `id`, `filePath`, `lineNumber` (0 for an
    image-level annotation, doc 23), `side`, `category`, `content`.

  Both hooks also receive the plugin's `PluginContext` (the same one passed to
  `activate`), so a hook can read settings, log, or update UI/config state.

## 31.3 Invocation

- **FR-31.3 — When they fire, and fail-soft.**
  - **`onReviewCreated(review, ctx)`** fires once the plugin subsystem is loaded
    for the review. Because the review is created by the CLI *before* the server
    starts, this is dispatched from `server.ts` right after `initContentPlugins`
    (the first point a plugin can observe the review).
  - **`onReviewCompleted(review, annotations, exportPath, ctx)`** fires from the
    completion route (`POST /api/review/complete`) **after** the review is marked
    complete and the `.glassbox/latest-review.md` export is written — mirroring the
    existing `--on-complete` CLI hook ordering. It receives the review, all its
    annotations, and the export path.

  Both are **fail-soft and asynchronous**: each hook runs inside a `try/catch`, a
  throwing or slow hook is logged (scoped `[plugin:<id>]`) and skipped, and it
  **never** blocks or fails review creation or completion. One plugin's failing
  hook does not prevent another's from firing.

## 31.4 Trust and network posture

- **FR-31.4 — Not a new trust grant; document outbound network.** A hook is **not**
  a new capability grant — plugins already run in-process at full trust (opt-in
  install is the boundary, no sandbox; [doc 14](14-security.md) / doc 29 §29.6), so
  a plugin can already do filesystem or network I/O inside `activate`. Hooks only
  provide the *right moments*. However, a hook that makes **outbound network
  calls** shifts Glassbox's default **local-first / loopback-only** posture, so
  that is a deliberate, documented consequence of installing such a plugin — see
  doc 29 §29.6. The host never itself initiates network I/O for a hook.

## Non-functional requirements

- **NFR-31.1 — Zero-hook no-op.** With no plugin registering `reviewHooks` (the
  default), or the subsystem disabled, `notifyReviewCreated` / `notifyReviewCompleted`
  are cheap no-ops — the review lifecycle is unchanged.

## Status

Shipped (GB-1065): the contract (`ReviewHooks` on `PluginRegistration`, the
`ReviewHookInfo` / `AnnotationHookInfo` shapes), the fail-soft dispatchers
(`notifyReviewCreated` / `notifyReviewCompleted` in `src/plugins/hooks.ts`,
re-exported from `src/plugins/index.ts`), and
both wiring points (`server.ts` after plugin load; the completion route after
export). Unit-tested (`tests/unit/plugins/reviewHooks.test.ts`) and verified live
end-to-end with a fixture plugin. A worked example (a hook that writes a JSON
summary next to the export) is in the developer guide. The heavier bidirectional
**integration backend** tier (annotation↔issue-tracker sync) is a separate,
deferred investigation (GB-1066).
