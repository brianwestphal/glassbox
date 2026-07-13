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

The enablement model + API are unit-tested (`plugins/enablement.test.ts`,
`plugins/loader.test.ts`) and verified live; a committed e2e that drives the tab
with a real installed plugin is gated on the fixture-plugin harness (GB-1043).
Until then, the tab's UI wiring is manual:

- **Plugins tab lists installed plugins** — Open Settings → Plugins with a plugin
  installed (e.g. the bundled Graphviz). The list shows its name, version,
  handled extensions, and a status dot (green = active, gray = disabled, red =
  failed load with the error).
- **Per-project + global disable toggles** — Unchecking "Enabled (this project)"
  disables the plugin for the current repo (its diagrams stop rendering, falling
  back to the code block / text diff); re-checking restores it. Unchecking
  "Enabled (all projects)" disables it everywhere and greys out the per-project
  toggle (global precedence).
- **Install-from-a-folder / uninstall** — Typing a plugin folder path + Install
  adds it to the list (the field clears on success); Uninstall removes it (and a
  bundled plugin stays gone via the dismiss-list). Installing a folder with no
  `manifest.json` shows a clean "not a Glassbox plugin" error, not a crash.
- **Browse… native folder picker (GB-1048, desktop only)** — Under Tauri, a
  **Browse…** button next to the install field opens a native folder dialog and
  **fills the field** with the chosen path (it does not auto-install — the user
  then clicks **Install**). The dialog must not freeze the app.
- **Manifest preferences (GB-1047)** — With the Graphviz plugin enabled, its row
  shows a **Layout engine** select (dot / neato / fdp / circo / twopi). Changing
  it auto-saves; re-open a `.dot` diagram in Rendered mode and the layout changes
  to the selected engine. *(The store + getSetting/setSetting + engine-applied
  render are unit-tested and verified live; this item is the tab's control
  rendering + auto-save, which needs the real UI.)*
- **Config layout — groups / labels / action buttons (GB-1059, FR-29.18)** — With
  the Graphviz plugin enabled, its preferences render inside a collapsible
  **Rendering** group (chevron toggles it; the engine select sits inside). Below
  it a **status label** reads "Not tested" and a **Test renderer** button, when
  clicked, runs the plugin's action and the label updates to "Renderer OK (dot)"
  in green (or an error in red). Changing the engine and re-testing reflects the
  new engine in the label. *(The manifest layout parse, the `onAction`/
  `updateConfigLabel` round-trip, and the label-resolution in the list response
  are unit/integration-tested — `plugins/manifest.test.ts`,
  `plugins/loader.test.ts`, `plugins/configLayout.test.ts`, `plugins/graphviz.test.ts`,
  and `api/plugins-routes.test.ts`; this item is the tab's layout rendering +
  button wiring, which needs the real UI — a committed e2e is gated on the
  fixture-plugin harness, GB-1043.)*
- **Plugin-rendered file uses the image viewer (GB-1052)** — Review a diff
  containing a `.dot`/`.gv` file with the Graphviz plugin enabled. The file shows
  a **Code | Rendered** toggle (like an SVG). *Code* is the normal text diff of
  the source; *Rendered* shows the diagram in the image viewer — **zoom** works,
  and for a modified file the image-mode segmented control (Metadata · A · B ·
  Side by Side · Difference · Slice) compares the two rendered diagrams. Disabling
  the plugin removes the toggle and the file falls back to a plain text diff.
  *(The rendering + image-route serving are unit/integration-tested; this item is
  the client toggle + zoom/mode wiring, which needs the real UI — a committed e2e
  is gated on the fixture-plugin harness, GB-1043.)*

## Automated Coverage Summary

- _(none yet — items move here as they gain automated coverage)_
