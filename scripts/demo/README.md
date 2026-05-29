# Demo SVG capture

Regenerates `assets/demo.svg` — the animated hero at the top of the project
README. It's a single self-contained, infinitely-looping SVG, framed in faux
browser/terminal window chrome with a caption band, that walks the whole
Glassbox loop:

1. **AI risk triage** — sidebar in risk mode with colored risk badges
2. Browse a file, then open the `src/auth/session.ts` split diff (with guided
   "Learn" notes and a pre-seeded `remember` annotation)
3. Click line 23, type a bug annotation, save it
4. Complete the review
5. Peek at the exported `.glassbox/latest-review.md`
6. A Claude Code terminal runs `/glassbox`, applies the fix, tests pass
7. The loop closes on the fixed diff
8. A branded end card

An on-screen cursor glides between targets (with click pulses) through the
Glassbox beats and hides for the terminal / markdown / end-card scenes.

Regenerate it whenever the UI changes in a way the hero should reflect (layout,
diff styling, the completion modal, etc.).

## Run it

```bash
npm run demo:capture
```

This builds the client assets, boots a real Glassbox server in `--demo:1` mode
with mocked AI (no API key needed), drives the live UI with Playwright, captures
each beat as SVG via [`domotion-svg`](https://www.npmjs.com/package/domotion-svg),
composites everything, and writes `assets/demo.svg`. Debug screenshots of each
captured beat land in `scripts/demo/.debug/` (gitignored).

### Stand-alone screenshot regeneration

```bash
npm run demo:capture-stills
```

Regenerates all of the *still* screenshots referenced from `README.md`. For
each `--demo:N` scenario (1–6) the script boots a real server, runs the
in-app navigation that puts the UI in the showcased state, then captures
both a **PNG** (Playwright `page.screenshot`) and a stand-alone **SVG**
(`captureElementTree` + `elementTreeToSvg`). Outputs land in `assets/` as
`demo-guided-review`, `demo-risk-mode`, `demo-narrative-mode`,
`demo-annotations`, `demo-settings`, and `demo-direct-comparison` (each
in both formats). Lives in `capture-stills.ts` and is intentionally
independent of the animated hero pipeline above — no overlays, no
composition, no chrome.

## Requirements

- **Chromium** (Playwright) — installed with the project's dev dependencies.
- **Must run outside any command sandbox.** Chromium needs to create macOS Mach
  bootstrap ports; a sandbox blocks that with a `mach_port_rendezvous … Permission
  denied` crash.
- **`domotion-svg`** — pinned to an exact version in `devDependencies`
  (currently `0.6.0`). The script calls `setRenderTextMode('embedded-font')` so
  the demo is always built in **embedded-font** mode: text is `<text>` rendered
  with an `@font-face` subset embedded in the SVG, so it looks identical on any
  viewer regardless of installed fonts, and it's lighter than the older
  per-glyph path-outline mode. The exact pin + explicit mode are deliberate — a
  domotion default-mode change (0.4.0 once flipped the default and briefly broke
  this) can't silently change the output. The capture asserts an `@font-face` is
  present and fails loudly otherwise (text would render as tofu without it).

## Files

- `capture-demo.ts` — the orchestrator (server lifecycle, UI driving, capture,
  composition). The storyboard lives near the top (target file/line, feedback
  text, captions, durations, transitions, overlays) and in the frame jobs +
  cursor track.
- `scenes.ts` — the hand-built scenes that aren't captured from the live app:
  the Claude Code terminal mock (`terminalSceneHtml`), the exported-markdown
  peek (`markdownPeekHtml`), and the branded end card (`endCardSvg`). The fix
  the terminal shows (URL-encoding the Redis session key) must match the
  annotation typed in `capture-demo.ts` and the loop-close frame.
- `chrome.ts` — SVG compositing: wraps each captured frame in browser/terminal
  window chrome + a caption band (`chromeWrap`), and exports the canvas /
  content dimensions and the content offset used to position overlays + cursor.

## Notes / gotchas

- The end card is **hand-built SVG**, not captured HTML — purely for precise
  branding/layout control (it's the one frame that isn't a screenshot of the app
  or a captured HTML scene).
- The risk badges use mocked (random) scores, so their exact values/order vary
  per run — that's cosmetic; the point is the colored risk triage.
- The typed feedback wraps natively (domotion's typing-overlay `bgWidth`) and
  shows a blinking insertion caret (`caret: true`); the terminal `/glassbox`
  prompt has a caret too.
