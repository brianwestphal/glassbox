# Manual Test Plan

A handful of documented behaviors are not reliably automatable (they depend on
real OS share sheets, live Claude sessions, multi-touch/pointer gesture syncing,
or subjective visual judgement). They are verified by hand against a running
`glassbox` before a release. Each item here corresponds to a requirement unit
that is `waived` in `docs/testing/feature-coverage.json` with a pointer back to
this file — see `docs/testing/9-feature-coverage.md` for the coverage model.

When you add automated coverage for one of these, remove it here, flip its
`feature-coverage.json` entry from `waived` to `tests`, and note it in the
Automated Coverage Summary below.

## Share (doc 16)

- **16.4 Permanent share access** — Settings → General has a "Share Glassbox"
  link that is always available (never dismissed). Clicking it triggers the same
  share action as the toolbar (OS share sheet, or clipboard-copy fallback with a
  confirmation toast). *(The share action itself — `triggerShare` — is
  unit-tested; this item is the settings-link wiring.)*

## Claude channel (doc 17)

- **17.4 Completion-modal Send-to-Claude** — With the Claude channel enabled and
  connected, completing a review shows a "Send to Claude" button in the
  completion modal. Clicking it triggers Claude with "Read
  `.glassbox/latest-review.md` and apply the feedback." and shows a "Sent!"
  confirmation. The button is hidden when the channel is not connected. *(The
  channel trigger endpoint and status gating are integration-tested; this item is
  the modal-button wiring against a live Claude session.)*

## Image comparison (docs 24, 28)

- **FR-24.7 Synced zoom/pan across side-by-side panes** — In Side-by-Side image
  mode, zooming or panning one pane applies the same transform to the other pane.
  *(The zoom/pan geometry is unit-tested in `client/zoom.test.ts` /
  `client/lightboxZoom.test.ts`; this item is the two-pane sync wiring, which
  needs real pointer/wheel gestures.)*
- **FR-28.5 Zoom/pan within the A / B focus views** — In the single-side A or B
  focus mode, the toolbar zoom actions (in/out/fit/actual) and pointer zoom/pan
  work on the shown side. *(Same shared zoom code as above; this item is the
  focus-view wiring.)*

## Content plugins — management tab (doc 29, GB-1040)

**Most of this is now automated** by the committed `chromium-plugin` e2e
(`tests/e2e/plugin-manage.test.ts`, GB-1070) — see the Automated Coverage Summary.
It drives, against a real installed fixture plugin: the installed list + status
dot, the global enable/disable toggle (removing/restoring the plugin's UI
element), a `select` preference (render + save + persist-across-reload), the
config-layout group + Test-button → status-label round-trip, a diff-toolbar UI
element (render + click → toast), and the Available-to-install → Install → ready →
uninstall flow. The items below remain manual (the paths the e2e doesn't drive):

- **Per-project disable toggle + graying** — Unchecking "Enabled (this project)"
  disables the plugin for the current repo only (its diagrams stop rendering,
  falling back to the code block / text diff); re-checking restores it. Unchecking
  "Enabled (all projects)" greys out the per-project toggle (global precedence).
  *(The **global** enable/disable toggle is e2e-covered, GB-1070; the per-project
  scope + graying is the manual remainder.)*
- **Install-from-a-folder** — Typing a plugin folder path + Install adds it to the
  list (the field clears on success). Installing a folder with no `manifest.json`
  shows a clean "not a Glassbox plugin" error, not a crash. *(Bundled-plugin
  uninstall is e2e-covered, GB-1070; install-from-an-arbitrary-folder + the error
  case is the manual remainder.)*
- **Browse… native folder picker (GB-1048, desktop only)** — Under Tauri, a
  **Browse…** button next to the install field opens a native folder dialog and
  **fills the field** with the chosen path (it does not auto-install — the user
  then clicks **Install**). The dialog must not freeze the app.
- **Available to install — real system-dependency provisioning (GB-1069)** — The
  Available-to-install list + the **self-contained** install → ready → uninstall
  flow is e2e-covered (GB-1070). What stays manual is the **real** provisioning
  that needs a system dependency / network, against the actual built plugins:
  - **PlantUML** with a JRE present → Install fetches `plantuml.jar` from Maven
    automatically → ready (review a `.puml` in Rendered mode). With **no JRE**, it
    still fetches the jar but shows an instruction to install Java, then Install again.
  - **Mermaid** with `npm` present → Install runs `npm install` (downloading a
    Chromium — slow) → ready. With **no `npm`**, it installs the plugin but shows an
    instruction to install Node.js (or run the CLI `setup.mjs`), then Install again.
  - **image-codecs** self-contained install is fully e2e-covered.
- **Graphviz engine preference applies at render** — With Graphviz enabled, its row
  shows a **Layout engine** select; changing it and re-opening a `.dot` diagram in
  Rendered mode renders with the new engine. *(The **select preference render +
  auto-save + persist** is now e2e-covered, GB-1070; the engine-applied-**render**
  is separately unit-tested — this item is the end-to-end visual confirmation.)*
- **Plugin UI extensions — header / sidebar-footer / link + stateful controls (GB-1058/1068, doc 30)**
  — The **diff-toolbar button** render + click → toast + enable/disable show/hide is
  e2e-covered (GB-1070). What stays manual: a plugin registering a **`header`** or
  **`sidebar-footer`** element shows it in the main-content top bar / below the
  Complete–Reopen controls; a **`link`** element opens its URL in a new tab; and the
  **stateful controls (GB-1068)** — a **toggle** flips its off↔on face
  (highlighted when on), toasts the new state, and **persists** across a settings
  reopen (host-persisted per `stateKey`); a **`switch`** behaves the same; a
  **`segmented-control`** highlights the selected segment(s) per its selection mode
  (`exactly-one` keeps one selected, `zero-or-more` toggles each independently).
  Exercise these with a scratch plugin (e.g. a copy of
  `tests/fixtures/plugin/fixture-diagram/` with the element type under test) —
  shipped first-party plugins deliberately register no UI elements (the slots are
  global chrome; the graphviz demo button + Grid toggle were removed for this).
  *(The registration, `GET /api/plugins/ui`,
  and the `onAction`→`result.message` round-trip are unit/integration-tested —
  `plugins/loader.test.ts`, `plugins/configLayout.test.ts`,
  `api/plugins-routes.test.ts`; this item is the client slot rendering + click →
  toast, which needs the real UI — a committed e2e is gated on the fixture-plugin
  harness, GB-1043.)*
- **PlantUML plugin — local Java render (GB-1046, needs a JRE)** — Install the
  opt-in PlantUML plugin: `npm run build:plugins` then `node plugins/plantuml/setup.mjs`
  (checks Java, installs into `~/.glassbox/plugins/plantuml/`, downloads
  `plantuml.jar`). Review a diff containing a `.puml` file: it shows the **Code |
  Rendered** toggle (like an SVG); *Rendered* shows the diagram rendered by the
  local `java -jar plantuml.jar` subprocess. With Java or the jar **absent**, the
  file falls back to the plain code-block/text diff (no error). *(The renderer's
  fail-soft paths + SVG extraction are unit-tested, and `plugins/plantuml.test.ts`
  also has a **Java-gated live-render test** that runs the real `java -jar` path
  whenever a JRE + jar are present — set `PLANTUML_JAR`, or install via `setup.mjs`
  — and skips otherwise. Unlike the Apple FM path this is **not** a hardware gate
  (Java + a downloadable jar are provisionable in CI). Run it with
  **`npm run test:live`**: it is gated on `GLASSBOX_LIVE_RENDER_TESTS` on top of
  the jar check, because spawning a JVM alongside the default suite's ~150
  concurrent files lost the CPU race and blew a 30s timeout. This manual item is
  the full in-viewer Code|Rendered experience.)*
- **Mermaid plugin — local headless-browser render (GB-1045, needs Chromium)** —
  Install the opt-in Mermaid plugin: `npm run build:plugins` then
  `node plugins/mermaid/setup.mjs` (installs into `~/.glassbox/plugins/mermaid/`
  and `npm install`s `@mermaid-js/mermaid-cli` + puppeteer there, downloading a
  Chromium). Review a diff containing a `.mmd`/`.mermaid` file: it shows the
  **Code | Rendered** toggle (like an SVG); *Rendered* shows the diagram rendered
  by the local `mmdc` subprocess. With `mmdc` **absent**, the file falls back to
  the plain code-block/text diff (no error). In locked-down/rootless environments
  where Chromium won't launch, point `MERMAID_PUPPETEER_CONFIG` at a JSON config
  (e.g. `{"args":["--no-sandbox"]}`). *(The renderer's fail-soft paths + SVG
  extraction + CLI-path resolution are unit-tested, and `plugins/mermaid.test.ts`
  also has a **browser-gated live-render test** that runs the real `mmdc` path
  whenever it's present — set `MERMAID_MMDC`, or install via `setup.mjs` — and
  skips otherwise. Like PlantUML and unlike the Apple FM path this is **not** a
  hardware gate (a headless browser is provisionable in CI) — verified live via
  headless Chromium. Run it with **`npm run test:live`**: it is gated on
  `GLASSBOX_LIVE_RENDER_TESTS` on top of the `mmdc` check, because launching
  Chromium alongside the default suite's ~150 concurrent files failed at browser
  *launch* (not on time, so its 60s timeout never helped). This manual item is
  the full in-viewer Code|Rendered experience.)*
- **Image-codecs plugin — WebP/AVIF ground-truth scoring (GB-1064)** — Install the
  opt-in image-codecs plugin: `npm run build:plugins` then
  `node plugins/image-codecs/setup.mjs` (copies the self-contained plugin into
  `~/.glassbox/plugins/image-codecs/`; no download). Launch a **ground-truth**
  review (`glassbox --ground-truth <manifest.json>`, doc 26) whose comparisons use
  **`.webp`** and/or **`.avif`** images. With the plugin **enabled**, each such pair
  shows a **perceptual difference score** badge and participates in
  most-different-first sorting / identical-hidden filtering — exactly like a
  PNG/JPEG pair. With the plugin **disabled** (or uninstalled), the same pairs show
  the images but **no score** (unscored, unsupported format) — nothing crashes.
  *(The decoders + the capability wiring are unit-tested against real WebP/AVIF
  fixtures — `plugins/image-codecs.test.ts` — and the built self-contained bundle
  was verified live decoding them; this manual item is the full in-app ground-truth
  scoring experience with the plugin toggled.)*
- **Plugin-rendered file — zoom + comparison modes (GB-1052)** — Review a diff
  containing a `.dot`/`.gv` file with the Graphviz plugin enabled and open the
  **Rendered** view. Confirm the image viewer's **zoom** (in/out/fit/actual +
  pointer) works and, for a modified file, the image-mode segmented control
  (Metadata · A · B · Side by Side · Difference · Slice) compares the two rendered
  diagrams. *(The core render path — the Code|Rendered toggle, the Rendered SVG
  served as `image/svg+xml`, and the artifact-path inline SVG — is now covered by
  the committed `chromium-plugin` e2e, GB-1043. What remains manual is the
  zoom/comparison-mode pointer interaction on a plugin-rendered file, which reuses
  the shared image-viewer gestures already in the manual plan above.)*

## Automated Coverage Summary

- **Content-plugin render paths (doc 29 FR-29.2 / FR-29.13, GB-1043)** — the
  committed `chromium-plugin` Playwright project (`tests/e2e/plugin-render.test.ts`)
  boots a `--diff` server with a real fixture content plugin installed in an
  isolated `GLASSBOX_CONFIG_DIR` and a committed `.pr-notes/` note, asserting both
  integration points end-to-end: the **file-diff path** (a `.fdiag` file gets the
  Code|Rendered toggle; Rendered serves the plugin's SVG as `image/svg+xml`) and
  the **artifact path** (a review-note `.fdiag` artifact renders as an inline
  `data:image/svg+xml` `<img>`). Previously verified only by hand.
- **Content-plugin management tab (doc 29 FR-29.12/16/18/20, doc 30 FR-30.3/5, GB-1070)**
  — `tests/e2e/plugin-manage.test.ts` (same `chromium-plugin` server) drives the
  Settings → Plugins tab against a real installed fixture plugin: the installed
  list + active status dot; the **global enable/disable** toggle (removing +
  restoring the plugin's diff-toolbar UI element); a **`select` preference** (render
  + auto-save + persist across a full reload); the **config-layout** group +
  **Test-button → status-label** round-trip; a **diff-toolbar UI element** (render +
  click → toast); and the **Available-to-install → Install → ready → uninstall**
  flow (a self-contained opt-in fixture in `GLASSBOX_BUNDLED_PLUGINS_DIR`). This
  e2e caught + drove the fix for a real bug: the preference-change delegate's
  `asInput` threw on a `<select>`, so **no** select preference (including graphviz's
  `engine`) actually saved from the UI. Previously all manual.
