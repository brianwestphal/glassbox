# Demo SVG capture

Regenerates `assets/demo.svg` — the animated hero at the top of the project
README. It's a single self-contained, infinitely-looping SVG: each beat is a
rounded browser/terminal window floating on a **transparent** canvas (so it sits
on any README background, light or dark) with a broadcast-style **lower-third**
caption (accent bar + `GLASSBOX` eyebrow). It walks the whole Glassbox loop:

1. **CLI launch** — a real terminal recording (`domotion term`): `git status -s`
   shows the uncommitted changes, then `npx glassbox` runs; the live app then
   **pops in over** the terminal (a layered reveal — the app window scales in on
   top while the terminal fades out behind it, see `popIn.ts`)
2. **AI risk triage** — sidebar in risk mode with colored risk badges
3. Browse a file, then open the `src/auth/session.ts` split diff (with guided
   "Learn" notes and a pre-seeded `remember` annotation)
4. Click line 23, type a bug annotation, save it
5. Complete the review
6. Peek at the exported `.glassbox/latest-review.md`
7. A Claude Code terminal recording (`domotion term`) runs `/glassbox`, applies
   the fix, tests pass
8. The loop closes on the fixed diff
9. A branded end card (floating in the same window rect)

An on-screen cursor glides between targets (with click pulses) through the
Glassbox beats and hides for the launch / terminal / markdown / end-card scenes.

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

Both pipelines also drop a **Playwright HAR** next to their other outputs
(`assets/demo.har` for the animated capture, `assets/demo-<slug>.har` per
stills scenario) so any oddity in a capture can be replayed and inspected
from the recorded network traffic. The HARs are gitignored — multi-MB
binary churn isn't worth tracking — but they're handy locally and Chrome
DevTools / VS Code can both open them directly.

## Requirements

- **Chromium** (Playwright) — installed with the project's dev dependencies.
- **Must run outside any command sandbox.** Chromium needs to create macOS Mach
  bootstrap ports; a sandbox blocks that with a `mach_port_rendezvous … Permission
  denied` crash.
- **`domotion-svg`** — pinned to an exact version in `devDependencies`
  (currently `0.21.1`). The script calls `setRenderTextMode('embedded-font')` so
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
- `casts.ts` — asciinema-v2 `.cast` generators for the two **terminal beats**
  (`launchCast`, `claudeCast`), rendered through `domotion term`
  (`castToTermFrames`) so they read as a genuine terminal session (incremental
  line reveal, a real caret, hard cuts between settle points) rather than HTML
  mocks crossfaded together. The `git status -s` files match the demo review
  (`DEMO_FILES`); the fix the Claude session shows (URL-encoding the Redis
  session key) must match the annotation typed in `capture-demo.ts` and the
  loop-close frame.
- `scenes.ts` — the remaining hand-built scenes that aren't captured from the
  live app: the exported-markdown peek (`markdownPeekHtml`) and the branded end
  card (`endCardSvg` — the app icon over a single-color wordmark, floated in the
  shared `chrome.ts` `CARD` rect).
- `chrome.ts` — SVG compositing: wraps each captured frame in a rounded
  browser/terminal window on a transparent canvas (hairline border, no drop
  shadow — it would clip at the tight canvas margins) plus a left-anchored
  lower-third caption (`chromeWrap`), and exports the canvas / content / `CARD`
  dimensions and the content offset used to position overlays + cursor.

## Notes / gotchas

- The end card is **hand-built SVG** (the only hand-built frame) — purely for
  precise branding/layout control; the app beats are live screenshots and the
  terminal beats are `domotion term` cast renders.
- **Why not domotion's creative-template pack (`cta` / `title-card` / `compare` /
  …)?** This pipeline is a bespoke `generateAnimatedSvg()` composition: a single
  unified embedded-font subset collected across every captured beat
  (`getEmbeddedFontFaceCss`, asserted present or we throw), **per-frame static
  `svgContent`** with the compositor owning the timeline + cursor track, and every
  beat **floated in the shared window `CARD` rect** on a transparent canvas. The
  built-in templates render as **full-bleed, standalone _animated_ SVGs** — so
  dropping one into a frame gives a static snapshot (per domotion's llms.txt,
  animated-inside-animated needs `composite`), its typography won't share our
  embedded font subset, and full-bleed breaks the floating-window aesthetic every
  other beat shares. A side-by-side render confirmed the hand-built end card reads
  better than the `cta` template here (it keeps the `$ npx glassbox`
  terminal-command pill; `cta` is a generic web button). Keep the beats bespoke;
  reach for a template only if the pipeline is ever re-architected around
  `composite`.
- The risk badges use mocked (random) scores, so their exact values/order vary
  per run — that's cosmetic; the point is the colored risk triage.
- The typed feedback wraps natively (domotion's typing-overlay `bgWidth`) and
  shows a blinking insertion caret (`caret: true`); the terminal `/glassbox`
  prompt has a caret too.
- **Transition semantics (domotion 0.16+, DM-1414): a frame's `transition` is how
  it EXITS to the next frame; its ENTRANCE is driven by the PREVIOUS frame's
  transition.** So to change how beat B *arrives*, set beat A's transition, not
  B's. Getting this backwards silently shifts every transition by one beat (it put
  the "don't fade the typed note" cut on the wrong boundary once). Consecutive app
  beats **cut** (a crossfade between two near-identical app states just ghosts).
- **Slide-in (`push-left`) doesn't engage in this pipeline** — the outgoing frame
  slides out but the incoming one cuts in after it, flashing the transparent canvas
  in the gap. So scene changes use **cuts**; the terminal→app reveals use the
  layered pop-in (`popIn.ts`); only the loop seam (loop→end-card→launch) crossfades.
