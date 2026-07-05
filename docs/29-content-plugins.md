# 29. Content Plugins (Renderers & Differs)

> **Status: Design only.** This document specifies the contract and loader; no
> implementation has landed yet. The build is split across follow-up tickets —
> the core loader/contract, desktop delivery, the management UI, and the developer
> guide — with diagram-source rendering as the first reference plugin. See
> [§29.8](#298-status-and-follow-ups).

Glassbox stays lean and local-first by keeping heavy, format-specific code out of
the base install and desktop bundle. But some content types are worth rendering
richly — diagram *source* as an actual diagram (Mermaid / Graphviz / PlantUML),
notebooks, CAD, rich logs, proprietary formats. Each of those pulls in a multi-MB
renderer that does not belong in core.

This document defines a **plugin boundary** so specialized content **renderers**
(single file/blob → view) and **differs** (old vs new → diff view) live *outside*
core and are installed opt-in. Core ships the contract, the loader, and the
graceful fallbacks; specialized visualizers ship as installable plugins.

Glassbox already had the seed of this pattern — the image-diff component and the
former WASM SVG rasterizer (`@resvg/resvg-wasm`, since replaced by the live-`<img>`
SVG path). This generalizes that one-off into an extensible API. The design
deliberately mirrors the plugin system already shipping in the sibling **Hot
Sheet** app (`~/Documents/hotsheet`, its `docs/18-plugins.md` + `src/plugins/`):
directory-based discovery, a zod-validated manifest as the single trust boundary,
an `activate(context)` lifecycle that returns a capability, self-contained
esbuild-bundled plugins loaded by dynamic `import()`, bundled/official plugins
auto-installed into the user's plugin directory, in-process full trust, and
fail-soft loading. Hot Sheet's capability is a `TicketingBackend`; ours is a
content `renderer` / `differ`. Everything else transfers.

## 29.1 Overview and goals

- **FR-29.1 — Plugin boundary.** Specialized renderers and differs shall live
  *outside* core and be installed opt-in. Core shall ship only the contract, the
  loader, the dispatcher, and the fallbacks. Installing a plugin shall be the only
  way heavy format-specific code enters a Glassbox install.
- **FR-29.2 — One API, two integration points.** A single plugin API shall serve
  **both** the file diff viewer (arbitrary content types, [doc 4](4-diff-viewing.md)
  / [doc 18](18-direct-comparison.md)) **and** review-note artifacts
  ([doc 20](20-ai-review-notes.md) §20.5). A plugin that renders a content type
  shall render it in both places; there is no separate artifact-only or
  diff-only plugin kind.

## 29.2 Discovery and installation

- **FR-29.3 — Plugin directory.** Plugins shall be discovered from a single
  global directory, `~/.glassbox/plugins/`, with one subdirectory per plugin.
  Discovery shall follow symlinks that resolve to a directory, so a plugin can be
  installed by symlinking its source tree in (used by "install from disk").
- **FR-29.4 — Manifest and validation.** Each plugin shall carry a
  `manifest.json` (or a `package.json` with a `glassbox` field) declaring at least
  its id, name, version, entry point, and the content types it handles. The
  manifest shall be validated by a zod schema at load time; that validation is the
  **single trust boundary** of the loader. A plugin whose manifest fails
  validation is skipped (see fail-soft, FR-29.6).
- **FR-29.5 — Self-contained bundles.** A plugin's entry point shall be a single
  self-contained ESM file that carries its own dependencies (produced by an
  esbuild-style `--bundle`). The loader shall resolve nothing against the host's
  `node_modules`; it only dynamic-`import()`s the one entry file by `file://` URL.
  This is the property that lets user-installed plugins load identically in dev,
  in a global npm install, and inside the packaged desktop app whose sidecar
  `node_modules` is frozen (see FR-29.7).
- **FR-29.6 — Fail-soft activation.** The loader shall dynamic-`import()` each
  plugin's entry and call its `activate(context)` lifecycle function, registering
  whatever renderers/differs it returns. A plugin that throws on import or
  activation, is missing its entry, or fails manifest validation shall be recorded
  with an error status and skipped — it shall never crash server startup or
  disable other plugins.
- **FR-29.7 — Desktop delivery.** Plugins shall work in the packaged Tauri
  desktop app, not only CLI/npm installs. Because the sidecar's `node_modules` is
  frozen (an end user cannot `npm install` into a `.app`), the delivery model is:
  first-party/official plugins are **bundled inside the app** and, on startup,
  **auto-installed into `~/.glassbox/plugins/`** with a version + content-hash
  freshness check (re-install when missing, older, or same-version-but-byte-
  different) and a dismiss-list so a user's uninstall of a bundled plugin sticks.
  Users may also **install from disk** (a native folder picker that symlinks the
  chosen directory into `~/.glassbox/plugins/`). Combined with the self-contained
  bundle rule (FR-29.5), this makes a frozen sidecar irrelevant to plugin loading.

## 29.3 The contract

- **FR-29.8 — Content matching.** A plugin shall declare the content types it
  handles by **extension**, **MIME type**, and/or a **content sniff** (a predicate
  over the leading bytes). The dispatcher shall select, for a given file/artifact,
  the highest-priority registered handler that matches; ties resolve to the most
  specific match (sniff > MIME > extension) then plugin load order.
- **FR-29.9 — Renderer contract.** A renderer shall be a function
  `render(input) → view`, where `input` is the content bytes/text plus metadata
  (path, MIME, and which side it is — old/new/single), and `view` is **safe,
  inert HTML or SVG** (see NFR-29.2). This is the single-file/blob → view path
  used for an added/deleted file, a single-image-style view, and a review-note
  artifact.
- **FR-29.10 — Differ contract.** A differ shall be a function
  `diff(old, new) → view`, where `old` and `new` are each the side's bytes/text
  plus metadata, and `view` is a safe diff view. This is the old-vs-new path used
  for a modified file. A plugin may provide a differ, a renderer, or both; when a
  plugin handles a modified file but supplies only a renderer, the viewer shows
  the two sides rendered independently (as the image comparison modes already do).
- **FR-29.11 — Registration.** A plugin's `activate(context)` shall return its
  registration — `{ renderers?, differs? }` — or nothing. A plugin that returns
  neither is a valid no-op (e.g. a plugin that only contributes a preference or a
  future UI affordance). Registration is additive into the in-memory registry the
  dispatcher reads.
- **FR-29.12 — Plugin context.** `activate` shall receive a `PluginContext`
  giving the plugin a scoped logger and access to its own persisted configuration
  (`getSetting` / `setSetting`), resolving secrets through the OS keychain the
  same way Glassbox stores API keys ([doc 14](14-security.md) §14.4). The context
  is the plugin's only sanctioned channel to host services.

## 29.4 Where plugins run

- **FR-29.13 — Server-side by default.** Heavy renderers shall run **server-side**
  and return safe HTML/SVG to the client, keeping the client IIFE bundle lean and
  the app offline (the precedent is the SVG path: rendered server-side / served as
  bytes, displayed in a native `<img>` that neither executes scripts nor loads
  external resources). A plugin **may** additionally ship light client-side assets
  served from a per-plugin static route, but that is optional and out of scope for
  the first implementation.

## 29.5 Fallback

- **FR-29.14 — Graceful fallback.** When no plugin matches a content type, or the
  matching plugin errors, the current behavior shall be unchanged: text and
  diagram *source* render as the existing collapsible code block, images render as
  `<img>`, and everything else uses today's default view. Where a well-known
  content type *would* be handled by an available-but-not-installed plugin, the
  fallback view may show a non-blocking **"install X to render"** hint. No network
  fetch and no CDN are ever used to satisfy a missing plugin (local-first).

## 29.6 Trust and security

- **FR-29.15 — Opt-in install is the trust boundary; no runtime sandbox.**
  Plugins execute code in-process, server-side, at the application's own trust
  level. There is no per-plugin sandbox or subprocess isolation. This is
  consistent with [doc 14](14-security.md)'s threat model (the local machine is
  trusted; the server binds to loopback only) and with the fact that installing a
  plugin is an explicit, deliberate act by the user — the same trust decision as
  adding any npm dependency. Manifest zod-validation (FR-29.4) is the load-time
  boundary; fail-soft loading (FR-29.6) contains buggy plugins. Plugin secrets, if
  any, are keychain-backed (FR-29.12).
- **FR-29.16 — Per-project, opt-in enablement.** A plugin's *code* is installed
  globally, but its *enablement* shall be per-project and default **off**. Turning
  a plugin on for one project shall not enable it for another. (Mirrors Hot
  Sheet's per-project enablement; the trust decision stays explicit at both
  install and enable time.)

## 29.7 First reference plugin

- **FR-29.17 — Diagram-source rendering.** The first reference plugin shall be
  diagram-source rendering (Mermaid / Graphviz / PlantUML — see
  [GB-910](20-ai-review-notes.md) §20.11), registering a renderer for `.mmd` /
  `.mermaid` / `.dot` / `.gv` / `.puml` that renders **server-side to SVG**, with
  the existing code-block view as the fallback for an uninstalled plugin or an
  unsupported syntax. It proves the renderer contract end-to-end across both
  integration points (a diagram file in the diff viewer and a diagram-source
  review-note artifact). It is **specified here but built as its own follow-up**
  once the loader and contract exist; it is not part of the core loader work.

## Non-functional requirements

- **NFR-29.1 — Lean core, offline, no CDN.** Core shall not gain any
  format-specific renderer dependency. All plugin code and assets are local; no
  plugin path may reach out to a CDN or remote host to render (local-first,
  consistent with [doc 14](14-security.md)).
- **NFR-29.2 — Safe output.** A renderer/differ's returned HTML/SVG shall be inert
  with respect to the content it renders: script-free and without external
  resource loads. SVG output shall be delivered so it cannot execute scripts
  (e.g. via `<img>` or an equivalently neutralizing path), matching how Glassbox
  already serves live SVGs. Plugins are trusted (FR-29.15), but their *output over
  untrusted review content* must not become an injection vector.
- **NFR-29.3 — Zero-plugin no-op.** With no plugins installed (the default), the
  subsystem shall add no measurable cost and no behavior change: discovery over an
  empty/absent `~/.glassbox/plugins/` is cheap, the dispatcher always falls
  through to the built-in views, and the client bundle is unchanged.
- **NFR-29.4 — Feature flag / kill-switch.** The whole subsystem shall sit behind
  a build/kill-switch flag (mirroring Hot Sheet's `PLUGINS_ENABLED`) so it can be
  disabled wholesale — skipping discovery, loading, dispatch, and any plugin UI —
  without removing code.

## 29.8 Status and follow-ups

This is a design/architecture document. Nothing is implemented yet; every FR/NFR
above is **Design only** and is recorded as a justified `waived` entry in
`docs/testing/feature-coverage.json` until the corresponding code lands, at which
point the waiver is replaced by a real asserting test.

The build is decomposed into follow-up tickets:

- **Content-plugin core** (GB-1038) — manifest schema + validation, discovery,
  fail-soft activation, the `ContentRenderer` / `ContentDiffer` / `PluginContext`
  contract, the content-type dispatcher, wiring into the diff viewer **and** the
  review-note artifact path, the fallback, and the feature flag.
- **Desktop delivery** (GB-1039) — the esbuild plugin build path, the
  `build-sidecar.sh` copy, bundled-plugin auto-install (version + content-hash
  freshness + dismiss-list), and install-from-disk. Realizes FR-29.5 / FR-29.7.
- **Management UI** (GB-1040) — a Settings **Plugins** tab: list installed
  plugins with status, per-project enable/disable (FR-29.16), install-from-disk /
  uninstall, and manifest-declared preferences.
- **Developer guide** (GB-1041) — `docs/plugin-development-guide.md` plus a
  standalone, copy-paste `types.ts` so third parties can build plugins without
  depending on the Glassbox package.
- **First reference plugin** ([GB-910](20-ai-review-notes.md)) — diagram-source
  rendering, unblocked by the core loader.

## Implementation pointers (planned)

These are the seams the follow-up tickets will use; they do not exist yet.

- **Loader + registry + dispatcher** — a new `src/plugins/` folder (loader,
  manifest zod schema, in-memory registry, content-type dispatch), mirroring
  `~/Documents/hotsheet/src/plugins/` (`loader.ts`, `types.ts`).
- **Diff-viewer integration** — the content-type branch in the file view
  (`src/components/diffView.tsx` / `src/components/imageDiff.tsx` and the
  `/file/:fileId` path) consults the dispatcher before falling back to the
  built-in text/image views.
- **Artifact integration** — the review-note artifact render path
  (`src/review-notes/store.ts` `loadReviewNotesForFile` + `src/components/diffView.tsx`
  `ReviewNoteRows`) consults the same dispatcher, replacing the diagram-source
  code-block special-case with a plugin lookup + code-block fallback.
- **Desktop** — `dist/plugins/<id>/` built by an esbuild step, copied into the
  sidecar by `scripts/build-sidecar.sh`, auto-installed at startup from
  `global-config.ts`'s `~/.glassbox` dir.
