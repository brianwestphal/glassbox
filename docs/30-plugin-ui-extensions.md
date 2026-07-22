# 30. Plugin UI Extensions

Content plugins (doc [29](29-content-plugins.md)) contribute **content rendering**
— a renderer/differ whose output shows in the diff viewer and review-note
artifacts. This document covers the second UI surface: a plugin contributing
**interactive elements** (buttons, links) to a small set of predefined locations
in the main-app chrome, with a click → `onAction` round-trip. It mirrors the
sibling Hot Sheet plugin UI-extension system (`~/Documents/hotsheet`
`docs/18-plugins.md` §18.12), adapted to Glassbox's chrome and conventions.

The design keeps the doc-29 trust model intact (opt-in install, in-process full
trust, fail-soft, [doc 14](14-security.md) / doc 29 §29.6): a plugin ships only a
**declarative** element description — an inline-SVG icon, a label, and an action
id — never DOM or event handlers. The host builds every node and owns all wiring.

## 30.1 Capability

- **FR-30.1 — UI-extension capability.** Beyond content rendering (doc 29), a
  plugin **may** contribute interactive UI elements to predefined host locations.
  This is additive and orthogonal to the renderer/differ contract: a plugin that
  contributes only UI elements (no renderer) is valid, and the loader already
  supports a content-less plugin (doc 29 FR-29.11). The capability is gated by the
  same feature flag and enablement model as the rest of the plugin subsystem —
  when the subsystem is disabled, or a plugin is disabled, its UI elements do not
  appear.

## 30.2 Host locations

- **FR-30.2 — Predefined locations.** A UI element declares one `location` from a
  fixed set the host renders into. Glassbox supports three:
  - **`header`** — the main-content top bar (the `.diff-nav-bar`), right-aligned.
  - **`diff-toolbar`** — the bottom diff toolbar, always visible (outside the
    text/image sub-toolbars).
  - **`sidebar-footer`** — below the Complete/Reopen controls in the sidebar.

  Each location is a fixed server-rendered slot (`#plugin-ui-header`,
  `#plugin-ui-diff-toolbar`, `#plugin-ui-sidebar-footer` in
  `src/components/reviewShell.tsx`). A slot with no elements takes no layout space.

## 30.3 Element types

- **FR-30.3 — Element types.** The element contract (`src/plugins/types.ts`,
  `PluginUIElement`) is a discriminated union. All five types render:
  - **`button`** — `label?`, `icon?` (inline SVG string), `title?` (tooltip),
    `style?` (`default` / `primary` / `danger`), and a required `action` id. A
    click round-trips to `onAction` (FR-30.5).
  - **`link`** — a `url` opened in a new tab (`target="_blank" rel="noopener
    noreferrer"`), plus `label?` / `icon?` / `title?`.
  - **`toggle`** — a two-state button with distinct `on` / `off` faces (each
    `{ label?, icon?, title?, style? }`). Shows the current face + an `active`
    class when on.
  - **`switch`** — a labeled two-state control (`onLabel` / `offLabel`).
  - **`segmented-control`** — a row of `segments` (`{ id, label?, icon?, title? }`)
    with a `selectionMode`: `exactly-one` / `zero-or-one` / `zero-or-more` /
    `one-or-more`. The selection math (`src/client/plugins/segmentSelection.ts`) is
    pure + unit-tested.

  **Stateful controls** (toggle / switch / segmented-control) carry a **`stateKey`**.
  The host **persists** state there and **reflects** it, so authors get persistence
  for free: on interaction the client computes the new value and posts
  `{ actionId, value }`; the route writes `value` to the element's `stateKey` (via
  the plugin-settings store — global unless the key is a declared project-scoped
  preference) and passes it to `onAction`; `GET /api/plugins/ui` resolves each
  stateful element's current `value` from its `stateKey` so the client renders it
  in the right state. The `value` encoding is `'true'`/`'false'` for toggle/switch,
  a segment id (single-select modes) or a JSON id array (multi-select modes) for a
  segmented-control.

## 30.4 Registration

- **FR-30.4 — `registerUI` + the list endpoint.** A plugin registers its elements
  during `activate` via **`context.registerUI(elements)`** (a new `PluginContext`
  method). The call replaces the plugin's whole registered set (idempotent across
  re-activations). Registrations live in a process-global map in
  `src/plugins/loader.ts`, keyed by plugin id, and are **cleared before every full
  reload** so only currently-activated (enabled) plugins re-register — a disabled
  or uninstalled plugin's elements disappear. The client fetches the flattened
  list (each element tagged with its `pluginId`) from **`GET /api/plugins/ui`**,
  which returns only the elements of currently-loaded plugins. The client renders
  them into the location slots and re-renders after any enable / disable / install
  / uninstall.

## 30.5 Action round-trip

- **FR-30.5 — `onAction` + result.** Clicking a control calls
  **`POST /api/plugins/:id/action`** with `{ actionId, value? }`, which invokes the
  plugin's **`onAction(actionId, context, value?)`** (the same handler shared with
  config-layout buttons, doc 29 FR-29.18) against the plugin's live context — so
  the handler can read settings and call `updateConfigLabel`. `value` is present
  for a stateful control (the new state the host has already persisted, FR-30.3)
  and absent for a plain button. `onAction` **may return a `UIActionResult`** whose
  `message` the host surfaces as a transient toast; returning nothing means "no
  client feedback". The result rides back in the action response alongside the
  refreshed plugin list (no separate endpoint). Errors (unknown plugin/action)
  return a clean message the client toasts. The e2e fixture plugin
  (`tests/fixtures/plugin/fixture-diagram/`) carries the worked examples — a
  diff-toolbar button (click → toast) exercised by `tests/e2e/plugin-manage.test.ts`.
  Shipped first-party plugins deliberately register **no** UI elements: the
  location slots are global chrome (visible on every review regardless of file
  type), so a content plugin must not occupy one without a genuinely
  always-relevant action (enforced by a conventions test).

## 30.6 Trust and inertness

- **FR-30.6 — Declarative, inert elements.** A plugin never ships DOM, HTML, or
  event handlers — only a declarative element description. The host constructs
  every node and wires the click to an `action` id that round-trips to `onAction`.
  The one plugin-supplied markup that reaches the DOM is the **icon**, an inline
  SVG rendered inertly (an `<svg>` in the page executes no scripts and loads no
  external resources by the same reasoning as doc 29 NFR-29.2). Labels, titles,
  and URLs are auto-escaped as text/attributes by the JSX runtime. Consistent with
  doc 29 §29.6, the trust boundary is **opt-in install** (the icon SVG is treated
  as trusted plugin data), not per-string sanitization.

## Non-functional requirements

- **NFR-30.1 — Zero-plugin no-op.** With no plugin registering UI elements (the
  default), `GET /api/plugins/ui` returns an empty list and the location slots stay
  empty and take no space — the chrome is unchanged. Fetching + rendering is a
  cheap no-op.

## Status

Shipped (GB-1058): the contract (`PluginUIElement` union + `registerUI` +
`onAction` result), the loader registry + clear-on-reload, `GET /api/plugins/ui`,
the action-result passthrough on `POST /api/plugins/:id/action`, the three host
slots + client rendering (`src/client/plugins/uiExtensions.tsx`) for **button**
and **link**, with the e2e fixture plugin carrying the reference element.

Shipped (GB-1068): the **stateful controls** — `toggle` / `switch` /
`segmented-control` — with host-persisted `stateKey` state, the `{ actionId, value }`
round-trip, resolved-state attachment in `GET /api/plugins/ui`, and the pure
selection math (`src/client/plugins/segmentSelection.ts`). All five element types
now render. (The `graphviz` plugin briefly shipped a demo diff-toolbar button +
sidebar-footer Grid toggle as worked examples; they were removed because doc-30
slots are global chrome and the demo controls showed on every review whenever the
plugin was installed. The reference elements live in the e2e fixture plugin.)

The client rendering + click wiring is manual-tested (`docs/manual-test-plan.md`),
gated on the fixture-plugin e2e harness (GB-1043) like the rest of the plugin UI.
