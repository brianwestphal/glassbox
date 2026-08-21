# 33. Native Modal Overlay Hosting

Glassbox's modal dialogs are built on `kerfjs/overlay` (`overlay()` / `confirm()`
/ `choice()`; see [8. User Interface](8-user-interface.md) and [15. Themes](15-themes.md)).
kerf 4.3 added an opt-in `native: true` that hosts a modal surface in a real
native `<dialog>` opened with `.showModal()` instead of a plain `<div>` overlay.
This document defines Glassbox's adoption of native hosting (GB-1143).

> **Status:** implemented on the `gb-1143-native-overlays` branch against kerf
> **4.3.0-beta.1**. It does **not** ship on `main` until kerf 4.3.0 is stable
> (don't put a beta framework version on main). The final **Tauri desktop
> webview** visual pass is outstanding (see NFR-33.2).

## Motivation

A native modal `<dialog>` gives two things a `<div>` overlay can't: it renders in
the browser **top layer** (guaranteed above any `z-index`) and it **inerts the
rest of the document** (pointer, focus, and assistive-tech), so the modal is
genuinely modal. Both matter most in the Tauri desktop webview.

## 33.1 Native hosting of modal surfaces

- **FR-33.1 — The modal surfaces use native hosting.** These six modal surfaces
  pass `native: true`: the settings dialog, theme manager, theme editor, and
  completion modal (`overlay(..., { className: 'modal-overlay' })`), plus
  `confirm()` (theme delete) and `choice()` (stale-annotations prompt) on the
  default `.kerf-overlay`. Each is hosted in a `<dialog>` opened modally
  (`:modal`), so its ARIA (role=dialog + aria-modal) is **implicit** and the rest
  of the document is inert. kerf feature-detects support and falls back to the
  `<div>` overlay where unavailable, so `native: true` is always safe to pass.
- **FR-33.2 — Centering, backdrop, and dismissal.** A native `<dialog>` centers
  itself and dims the page via its `::backdrop`; Glassbox styles both (kerf ships
  no CSS). The page-reset `* { margin: 0 }` zeroes the UA `margin: auto` that
  centers a modal dialog, so the wrapper explicitly restores `inset: 0; margin:
  auto`. The dim moves from the wrapper to `.<class>::backdrop`, the UA dialog
  chrome (border/padding/background/max-*) is reset so the inner
  `.modal`/`.kerf-confirm`/`.kerf-choice` is the visible box, and inner box
  widths are viewport-relative (`min(90vw, Npx)`) so they don't collapse inside a
  shrink-to-fit dialog. A click on the backdrop (outside the dialog box)
  dismisses, and Tab focus is contained to the dialog.

## 33.2 Body-appended child popups over a native modal

- **FR-33.3 — Child popups must live inside the dialog.** Because a native modal
  inerts everything **outside** it, a popup appended to `document.body` over the
  modal would be non-interactive. The theme manager's context menu is therefore
  appended to the overlay element (`handle.el`) instead of `document.body`, so it
  stays in the dialog's top-layer context and remains clickable. Its
  `position: fixed` still anchors it to the trigger, and the dialog's
  `overflow: visible` keeps it from being clipped. (Nested overlay surfaces —
  `confirm()` / `choice()` opened from within a dialog — are themselves native
  dialogs and stack correctly in the top layer, so they need no special
  handling.)

## Non-Functional Requirements

- **NFR-33.1 — Safe fallback.** Native hosting is feature-detected by kerf; on an
  engine without `<dialog>.showModal()` the same surfaces render as `<div>`
  overlays, and the `.<class>:not(dialog)` styling (full-screen flex + dim)
  applies. No behavior is lost, only the top-layer/inerting upgrade.
- **NFR-33.2 — Desktop webview verification (manual).** The decisive check is the
  Tauri desktop webview (WKWebView on macOS), where native dialogs matter and
  where any UA-style regression would show. This is a manual `npm run tauri:dev`
  screenshot pass; automated coverage is Chromium (Playwright) only, which
  exercises the native path and catches gross CSS/behavior regressions.

## Maintenance triggers

Update this document when a modal surface's `native` flag changes, when the
`<dialog>`/`::backdrop` CSS contract changes, or when a new body-appended popup
is opened over a native modal (it must follow FR-33.3). Remove the beta/branch
status note when kerf 4.3.0 is stable and this lands on `main`.
