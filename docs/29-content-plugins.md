# 29. Content Plugins (Renderers & Differs)

> **Status: Partially built.** The **P1 core** has landed (GB-1038): the
> renderer/differ contract, the zod-validated manifest, symlink-aware discovery
> under `~/.glassbox/plugins/`, fail-soft dynamic-`import()` activation, the
> priority/specificity dispatcher, the feature-flag kill-switch, and the
> review-note **artifact** integration with its code-block fallback — all in
> `src/plugins/`, loaded at server startup. The **file-diff-viewer** integration
> has also shipped (GB-1042, `src/plugins/fileView.ts`) — so **both** FR-29.2
> integration points are wired — as has the **developer guide** (GB-1041,
> `docs/plugin-development-guide.md`). The **first reference plugin** has shipped
> too — Graphviz `.dot`/`.gv` → SVG (`plugins/graphviz/`, GB-1044), and **desktop
> delivery** (GB-1039) — bundled plugins build to `dist/plugins/`, ship in the
> sidecar, and auto-install into `~/.glassbox/plugins/` at startup (freshness +
> dismiss-list) — and the **management UI** (GB-1040) — a Settings **Plugins**
> tab to list / enable-disable (global + per-project) / install / uninstall,
> manifest **preferences** (GB-1047/1054), and a native **folder picker**
> (GB-1048). The other two diagram renderers have also shipped as
> separately-installable, opt-in plugins: **Mermaid** (`plugins/mermaid/`,
> GB-1045; local `mmdc`/puppeteer subprocess) and **PlantUML**
> (`plugins/plantuml/`, GB-1046; local `java -jar` subprocess). Beyond
> renderers/differs, an additive **image-decoder capability** (`imageDecoders`,
> FR-29.19, GB-1063) lets a plugin decode bytes → RGBA so the perceptual diff
> ([doc 26](26-ground-truth-comparison.md) P2) can score formats core can't; its
> first reference plugin, **image-codecs** (WebP/AVIF via jSquash WASM,
> `plugins/image-codecs/`, GB-1064), has shipped too. Still open: a committed
> fixture-plugin **e2e** (GB-1043). See [§29.8](#298-status-and-follow-ups).

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

> **Scope — why image and SVG support stay core, not plugins.** A recurring
> question is whether the built-in image/SVG viewer should itself be reframed as a
> content plugin. It should not, for four reasons — recorded here so the decision
> isn't re-litigated:
>
> 1. **They are first-class git content types, not specialized/opt-in ones.** A
>    binary image (or SVG) diff is ordinary review, not a rare format a user opts
>    into. The plugin enablement model is opt-in install + disable + uninstall
>    (FR-29.15 / FR-29.16); routing core image review through it would let a user
>    *uninstall image support and break an ordinary diff*.
> 2. **The contract is the wrong shape.** A plugin is
>    `renderer/differ → RenderedView {svg|html}`, delivered inertly — "specialized
>    content → a view". Image support is not a leaf renderer: it is an interactive
>    multi-mode **comparison** viewer (Metadata / A / B / Side-by-Side / Difference
>    / Slice, [doc 4](4-diff-viewing.md) / [doc 24](24-image-comparison-layouts.md)
>    / [doc 28](28-image-side-focus.md)) with zoom/pan, drawn-region feedback
>    (`region_data`, [doc 23](23-image-feedback.md)), perceptual scoring
>    (`review_files.difference_score` + most-different-first sort,
>    [doc 26](26-ground-truth-comparison.md)), a ground-truth manifest mode, and
>    git old/new byte retrieval. The plugin API models none of that, and a plugin
>    has no business owning DB columns, routes, and a client subsystem.
> 3. **There is no heavy dependency to externalize.** The lean-core rationale
>    (FR-29.1, NFR-29.1) is to keep multi-MB format libraries (Mermaid, PlantUML)
>    out of core. Image/SVG has none: SVGs are served as raw bytes and rendered
>    live in an `<img>` (the `@resvg` WASM rasterizer was removed — see
>    [doc 4](4-diff-viewing.md)), and the perceptual-diff libraries
>    (`pixelmatch` / `pngjs` / `jpeg-js`) are pure JS that tsup **bundles** into
>    core. Nothing needs to move out.
> 4. **SVG is the plugin→viewer bridge, so the viewer must be core.** A plugin's
>    output is **SVG**, which the built-in image/SVG pipeline serves as
>    `image/svg+xml` and displays through the full comparison viewer (a
>    plugin-rendered file such as `.dot` is treated exactly like an `.svg`; see
>    FR-29.2 and the file-diff-viewer integration below). Making the viewer a
>    plugin would invert this layering — *plugins produce content; the built-in
>    viewer displays it* — and create a bootstrapping problem (what renders the
>    plugin's own SVG?).
>
> The plugin-shaped opportunity here is the opposite direction: *extending* image
> support to formats core can't handle (a plugin that decodes WebP/AVIF/HEIC to
> RGBA for the perceptual diff, or renders an exotic format to a preview) — an
> additive, opt-in capability, tracked separately, that never replaces the
> built-in path.

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
  A plugin may set **`autoInstall: false`** in its manifest to be **separately
  installable** — it is built (and may ship in the bundle) but is **not**
  auto-installed, so a plugin with a system requirement (e.g. PlantUML, which needs
  a JRE) is never forced on users; they opt in (GB-1046). `installBundledPlugins`
  skips it.

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
  registration — `{ renderers?, differs?, imageDecoders?, reviewHooks? }` — or
  nothing. A plugin that returns none of these is a valid no-op (e.g. a plugin that
  only contributes a preference or a UI affordance). Registration is additive into
  the in-memory registry the dispatcher reads.
- **FR-29.12 — Plugin context + preferences.** `activate` shall receive a
  `PluginContext` giving the plugin a scoped logger and access to its own
  persisted configuration (`getSetting` / `setSetting`). A plugin declares
  user-facing **preferences** in its manifest (`key` / `label` / `type` of
  string·number·boolean·select / `default` / `description` / `options` / `scope`
  of global·project); the Settings → **Plugins** tab renders them and auto-saves,
  and `getSetting(key)` returns the stored value (or the declared default).
  Non-secret values persist in the global config (`~/.glassbox/config.json`) or
  the project settings (`.glassbox/settings.json`) per the preference's scope
  (`src/plugins/settings.ts`, GB-1047). Setting a preference **reloads** the
  plugin so it re-reads the value (the reference `graphviz` plugin exposes a
  layout-`engine` preference). **Secret** preferences (`secret: true`) are stored
  in the **OS keychain** (account `plugin-<id>-<key>`, the same store as API keys,
  [doc 14](14-security.md) §14.4), never in config; the API/UI never return a
  secret's value — only whether it is configured (masked password input,
  GB-1054).
- **FR-29.19 — Image-decoder capability (bytes → RGBA).** A plugin **may**
  contribute one or more **image decoders** — `{ name, match, priority?,
  decode(input) }` where `decode({ bytes, path }) → DecodedImage | null` and
  `DecodedImage = { width, height, data: RGBA }` — via the additive
  `imageDecoders` registration key. Decoders are matched + tie-broken by the same
  `(priority, specificity)` rule as renderers (FR-29.8) and dispatched through
  `decodeImageWithPlugin(bytes, path, mime?)` (`src/plugins/index.ts`), which
  returns `null` fail-soft when the subsystem is disabled, no decoder matches, or a
  decoder returns null / throws. This lets the **perceptual diff** ([doc 26](26-ground-truth-comparison.md)
  §26 P2, `src/ground-truth/perceptual-diff.ts`) score ground-truth image pairs in
  formats core can't decode: core decodes PNG/JPEG (`pngjs`/`jpeg-js`) synchronously,
  and only when core can't does `comparePerceptual` (now async) consult an installed
  decoder before returning `undecodable`. The capability is purely additive — it
  does **not** touch the renderer/differ contract — so heavy/rare codecs (WebP/AVIF
  WASM) stay out of core and opt in by install (NFR-29.1). The first reference
  decoder plugin — `plugins/image-codecs/` (WebP/AVIF via jSquash WASM, GB-1064) —
  has **shipped**: it registers `.webp`/`.avif` decoders, is separately installable
  (`autoInstall: false`, ~1.8 MB of codec WASM), and makes those ground-truth pairs
  scorable. At launch the ground-truth branch initializes the plugin subsystem
  before scoring so an installed decoder is available (idempotent with the server's
  later init).

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
- **FR-29.16 — Enablement (enabled by default; two disable scopes).** A plugin's
  *code* is installed globally, and an installed plugin is **enabled by default**.
  It becomes inactive only when disabled, and there are two **independent disable
  lists**: **global** (disabled for every project, stored in `~/.glassbox/config.json`)
  and **per-project** (disabled for one repo, stored in `.glassbox/settings.json`).
  A plugin is enabled iff it is in **neither** list. **Global takes precedence**:
  a globally-disabled plugin is inactive everywhere and reports scope `global`
  even if also project-disabled (there is no project-level re-enable of a
  globally-disabled plugin). So the four states are: *uninstalled* (unknown to
  the system), *installed & enabled*, *installed & globally disabled*, and
  *installed & disabled for this project*. Changing a disable list takes effect
  on the next request (the subsystem reloads).

> **Outbound network is a plugin's choice, not the host's.** Glassbox itself binds
> to loopback and is local-first ([doc 14](14-security.md)). Because plugins run
> in-process at full trust, a plugin *can* make outbound network calls — nothing in
> the contract prevents it, and installing it is the trust decision. This matters
> most for the general (non-content) capabilities: a **review lifecycle hook**
> ([doc 31](31-plugin-lifecycle-hooks.md)) that phones out — to post results to an
> issue tracker, notify a chat, trigger CI — shifts the app's default local-only
> posture. That is a deliberate, documented consequence of installing such a
> plugin; the host never initiates network I/O on a plugin's behalf. Prefer
> keeping plugins offline unless the user has knowingly installed one whose purpose
> is an external integration.

## 29.7 First reference plugin

- **FR-29.17 — Diagram-source rendering.** The first reference plugin shall be
  diagram-source rendering (Graphviz / Mermaid / PlantUML), registering a
  renderer for the diagram extensions that renders **server-side to SVG**, with
  the existing code-block view as the fallback for an uninstalled plugin or an
  unsupported syntax. It proves the renderer contract end-to-end across both
  integration points (a diagram file in the diff viewer and a diagram-source
  review-note artifact). Built per-renderer, simplest first: **Graphviz
  (`.dot` / `.gv`) has shipped** as the first reference plugin
  (`plugins/graphviz/`, GB-1044) — server-side via `@viz-js/viz` (WebAssembly
  Graphviz, no DOM, no external process), which fits the server-side-SVG
  contract most cleanly. **Mermaid** (`.mmd` / `.mermaid`, needs a DOM — GB-1045)
  and **PlantUML** (`.puml`, needs Java — GB-1046) are the split siblings.
  **Mermaid ships as a separately-installable, opt-in plugin** (`plugins/mermaid/`,
  GB-1045), following the same model as PlantUML: Mermaid is fundamentally a
  **browser** library (it measures text via the DOM's `getBBox`), so there is no
  pure-JS/WASM engine and every maintained Node renderer drives a **headless
  browser**. It renders `.mmd` → SVG by spawning a **local** `mmdc`
  (`@mermaid-js/mermaid-cli` over puppeteer/Chromium) subprocess — offline /
  local-first, nothing sent to a network render service. Because it needs a
  headless browser it is **not auto-bundled** (`autoInstall: false` → skipped by
  `installBundledPlugins`), so core stays lean and no one is forced to have
  Chromium; a `setup` helper installs `@mermaid-js/mermaid-cli` + puppeteer into
  the plugin's install dir (fetching a Chromium on demand — not committed or
  shipped in the bundle). If `mmdc` is absent or a render fails, the renderer
  returns an empty view and the committed **code-block fallback** applies —
  nothing regresses. (`MERMAID_PUPPETEER_CONFIG` passes a puppeteer config through
  to `mmdc -p` for locked-down / rootless environments.)
  **PlantUML ships as a separately-installable, opt-in plugin** (`plugins/plantuml/`,
  GB-1046): it renders `.puml` → SVG by spawning a **local** `java -jar
  plantuml.jar` subprocess (PlantUML has no pure-JS/WASM engine; the only
  alternative — a network encoder offloading to `plantuml.com` — was rejected as it
  breaks local-first). A local Java subprocess **is** local-first, and because the
  plugin is **not auto-bundled** (`autoInstall: false` in its manifest → skipped by
  `installBundledPlugins`), core stays lean and no one is forced to have Java — the
  user opts in. It requires a **JRE + `plantuml.jar`** (documented system
  requirements; a `setup` helper checks Java + fetches the jar into the plugin
  dir). If Java or the jar is absent, or a render fails, the renderer returns an
  empty view and the committed **code-block fallback** (source shown, readable)
  applies — nothing regresses.

## 29.9 Settings config layout

- **FR-29.18 — Config layout, dynamic labels, and actions.** Beyond the flat
  preference list (FR-29.12), a plugin **may** declare an optional manifest
  **`configLayout`** — an ordered, recursive list of items that arranges its
  Settings → Plugins UI (`src/plugins/manifest.ts`, `ConfigLayoutItemSchema`).
  Item types: **`preference`** (renders a declared preference by `key`),
  **`divider`**, **`spacer`**, **`label`** (static or dynamic status text with a
  semantic `color` tone — `default` / `success` / `error` / `warning` /
  `transient`), **`button`** (a caption + an `action` id, optional `primary`
  style), and **`group`** (a collapsible titled section that nests items;
  `collapsed` sets the initial state, preserved across re-renders by native
  `<details>`). When `configLayout` is omitted the preferences render as a flat
  list (back-compat). A **`button`** invokes the plugin's optional
  **`onAction(actionId, context)`** (`src/plugins/types.ts`) via
  `POST /api/plugins/:id/action`; inside it the plugin calls
  **`context.updateConfigLabel(labelId, text, color?)`** to reflect status back
  into a `label`. Label overrides live in an in-memory map in `loader.ts`
  (keyed `pluginId:labelId`, cleared on uninstall); `describeInstalledPlugins`
  resolves each label's effective text/color (manifest default merged with any
  override) into the plugin's `configLabels`, so the action's response — the
  refreshed plugin list, per the "every mutation returns the list" convention —
  carries the new status with **no separate polling endpoint**. The client
  renderer is `src/client/settings/pluginsTab.tsx`; the host owns the tone→CSS
  mapping so labels stay consistent across plugins. The `graphviz` plugin's
  **Rendering** group + **Test renderer** button (renders a trivial graph, sets
  an OK/error status label) is the worked example. Plugin output stays
  content-only (NFR-29.2) — buttons carry no plugin-supplied HTML/icons.

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

The **P1 core has shipped** (GB-1038); its FR/NFR units carry real tests in
`docs/testing/feature-coverage.json`. The units not yet realized remain justified
`waived` entries there until their follow-up lands, at which point the waiver is
replaced by an asserting test.

The build is decomposed into follow-up tickets:

- **Content-plugin core** (GB-1038, **shipped**) — manifest schema + validation,
  discovery, fail-soft activation, the `ContentRenderer` / `ContentDiffer` /
  `PluginContext` contract, the content-type dispatcher, the review-note artifact
  integration + fallback, and the feature flag. Lives in `src/plugins/`.
- **File-diff-viewer integration** (GB-1042 + GB-1052, **shipped**) — the second
  integration point. A file a plugin renders to SVG is treated **like an SVG
  file**: it gets the **Code | Rendered** toggle, and the Rendered view routes
  its per-side SVG through the existing image viewer, so **zoom + A / B /
  Side-by-Side / Difference / Slice** all apply (GB-1052). `src/plugins/fileView.ts`
  (`renderPluginSvgSide` renders one side; `pluginRendersFile` gates); the image
  route serves the rendered SVG as `image/svg+xml`; the `/file/:id` `view=rendered`
  branch builds the `data-is-svg` `<ImageDiff>`; `/files` flags such files
  (`pluginRendered`) so the client shows the toggle. The **Code** side is the
  normal text diff of the source. Gated by a cheap path pre-check (no content read
  without an installed handler). Scope: text content types → SVG; binary content
  types (raw bytes) and non-SVG (HTML) plugin output are follow-ups.
- **Desktop delivery** (GB-1039, **shipped**) — `scripts/build-plugins.mjs`
  builds each plugin to `dist/plugins/<id>/`; `build-sidecar.sh` copies that into
  the sidecar (`server/plugins`); `src/plugins/install.ts` (`installBundledPlugins`)
  seeds `~/.glassbox/plugins/` at startup with a version + content-hash freshness
  check and a dismiss-list, plus `installPluginFromDisk` (symlink) / `uninstallPlugin`
  mechanisms for the management UI. Realizes FR-29.5 / FR-29.7. (The Tauri
  folder-picker UI that drives install-from-disk is GB-1040.)
- **Management UI** (GB-1040, **shipped**) — a Settings **Plugins** tab
  (`src/client/settings/pluginsTab.tsx`): lists installed plugins with status
  (active / disabled / failed), per-plugin **global** and **per-project** disable
  toggles (FR-29.16), install-from-a-folder (path) and uninstall, backed by
  `GET/POST/DELETE /api/plugins` (`src/routes/api/plugins.ts`). Manifest-declared
  **preferences** (FR-29.12, GB-1047) render here too. On desktop a **Browse…**
  button opens a native folder picker (GB-1048, the `pick_plugin_folder` Tauri
  command); the text-path field is the browser/CLI fallback.
- **Developer guide** (GB-1041, **shipped**) — `docs/plugin-development-guide.md`
  plus a standalone, copy-paste `types.ts` so third parties can build plugins
  without depending on the Glassbox package.
- **First reference plugin** (GB-1044, **shipped**) — the Graphviz `.dot`/`.gv`
  plugin (`plugins/graphviz/`), server-side to SVG via `@viz-js/viz` (WASM). Built
  by `scripts/build-plugins.mjs` (`npm run build:plugins`) into a self-contained
  `plugins/graphviz/index.js`. Split siblings both **shipped** as
  separately-installable, opt-in plugins: **Mermaid** (`plugins/mermaid/`,
  GB-1045; local `mmdc`/puppeteer subprocess) and **PlantUML**
  (`plugins/plantuml/`, GB-1046; local `java -jar` subprocess).
- **Image-decoder capability** (GB-1063, **shipped**) — the additive
  `imageDecoders` registration key (FR-29.19): `ImageDecoder` in
  `src/plugins/types.ts`, registered/dispatched by `ContentPluginRegistry`
  (`addImageDecoders` / `findImageDecoder`), exposed via
  `decodeImageWithPlugin(bytes, path, mime?)` in `src/plugins/index.ts`, and
  consulted by `comparePerceptual` (now async) in
  `src/ground-truth/perceptual-diff.ts` when core can't decode a format. The
  ground-truth launch path initializes plugins before scoring. Purely additive; no
  change to renderer/differ.
- **Reference decoder plugin: image-codecs** (GB-1064, **shipped**) —
  `plugins/image-codecs/` registers WebP + AVIF `imageDecoders` (bytes → RGBA) via
  the [jSquash](https://github.com/jamsinclair/jSquash) WASM codecs
  (`@jsquash/webp`, `@jsquash/avif`), esbuild-bundled into the self-contained
  `index.js` (the `.wasm` inlined via the `binary` loader added to
  `scripts/build-plugins.mjs`; the codec bytes are injected via a `WasmLoader` so
  the decoders unit-test in plain Node). No system dep, but **separately
  installable** (`autoInstall: false`, `setup.mjs` copies the self-contained build)
  to keep ~1.8 MB of codec WASM out of the default install. It contributes no
  renderer — browsers display WebP/AVIF natively; it only adds the decode-to-RGBA
  the perceptual diff needs. `@jsquash/*` are **devDependencies bundled into the
  plugin**, NOT core external deps (like graphviz's `@viz-js/viz`).

## Implementation pointers

Shipped in P1 (GB-1038):

- **Loader + registry + dispatcher** — `src/plugins/` (`types.ts` contract,
  `manifest.ts` zod schema, `loader.ts` discovery + fail-soft activation,
  `registry.ts` matching + priority dispatch, `index.ts` the process-global
  registry + `renderContent` / `diffContent` + startup `initContentPlugins`),
  mirroring `~/Documents/hotsheet/src/plugins/`. The kill-switch is
  `src/feature-flags.ts` (`PLUGINS_ENABLED`). Loaded at startup from
  `src/server.ts`.
- **Artifact integration** — `src/plugins/artifacts.ts` (`renderNoteArtifacts`)
  offers each text/diagram-source review-note artifact to the dispatcher; a match
  attaches inert `renderedSvg` / `renderedHtml` to the `ReviewNoteArtifact` view,
  which `src/components/diffView.tsx` renders (SVG via an `<img>` data URI) in
  place of the code block. Called from the `/file/:fileId` route
  (`src/routes/pages.tsx`). Zero-plugin installs are a no-op (unchanged behavior).
- **File-diff-viewer integration** (GB-1052) — `src/plugins/fileView.ts`
  (`renderPluginSvgSide`) renders one side to SVG; the image route
  (`src/routes/api/image.ts`) serves it as `image/svg+xml`; the `/file/:id`
  `view=rendered` branch (`src/routes/pages.tsx`) builds the `data-is-svg`
  `<ImageDiff>` (dims from the rendered SVG); `/files` flags plugin-rendered files
  (`pluginRendered`) and the client (`src/client/diff/index.tsx`,
  `stores/index.ts`) shows the Code/Rendered toggle + routes Rendered through the
  image viewer. The whole ImageDiff + zoom/slice/difference stack is reused
  unchanged — SVG is already a first-class image source.

- **Desktop delivery** — `scripts/build-plugins.mjs` (`npm run build:plugins`)
  esbuilds each plugin to `dist/plugins/<id>/`; `scripts/build-sidecar.sh` copies
  it into the sidecar (`server/plugins`); `src/plugins/install.ts`
  (`installBundledPlugins`, run from `initContentPlugins` before discovery) seeds
  `~/.glassbox/plugins/` with a version + content-hash freshness check +
  `dismissed-plugins.json`; `installPluginFromDisk` / `uninstallPlugin` back the
  management UI.

- **Enablement + management UI** — `src/plugins/enablement.ts` (global +
  per-project disable lists, global-precedence) gates the loader
  (`LoadedPlugin.status` gains `disabled`); `initContentPlugins(repoRoot)` /
  `reloadContentPlugins` apply it and `describeInstalledPlugins` reports it. The
  API is `src/routes/api/plugins.ts` (`GET/POST/DELETE /api/plugins`,
  `src/api/plugins.ts`); the UI is `src/client/settings/pluginsTab.tsx`. Per-repo
  state persists via the shared `src/project-settings-store.ts`.
- **Preferences** (FR-29.12, GB-1047) — the manifest `preferences` schema
  (`src/plugins/manifest.ts`), the value store (`src/plugins/settings.ts`,
  global config / project settings per scope), `PluginContext.getSetting`/
  `setSetting` wired in `loader.ts` `makeContext(manifest, repoRoot)`, the
  `POST /api/plugins/:id/preferences` setter (reloads the plugin), and the
  Plugins-tab rendering. The `graphviz` plugin's `engine` preference is the
  worked example.
- **Config layout + dynamic labels + actions** (FR-29.18, GB-1059) — the optional
  manifest `configLayout` (`ConfigLayoutItemSchema` in `src/plugins/manifest.ts`)
  arranges preferences into collapsible groups / dividers / spacers / status
  labels / action buttons; `PluginContext.updateConfigLabel` + the plugin's
  `onAction` (`src/plugins/types.ts`, run via `POST /api/plugins/:id/action`,
  `runPluginAction` in `index.ts`) drive dynamic status labels, folded into each
  plugin's `configLabels` in the list response (no polling endpoint). Rendered by
  `src/client/settings/pluginsTab.tsx`; the `graphviz` plugin's **Rendering**
  group + **Test renderer** button is the worked example.

Shipped (native folder picker, GB-1048): the `pick_plugin_folder` Tauri command
(`src-tauri/src/lib.rs`, `tauri-plugin-dialog`, granted in
`capabilities/remote-localhost.json` + `build.rs`) opens a native folder dialog;
the Plugins tab shows a **Browse…** button under Tauri that installs the picked
folder. Compile-verified (`cargo check`); the dialog opening itself needs a
desktop smoke-test.
