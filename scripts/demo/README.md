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

## Requirements

- **Chromium** (Playwright) — installed with the project's dev dependencies.
- **Must run outside any command sandbox.** Chromium needs to create macOS Mach
  bootstrap ports; a sandbox blocks that with a `mach_port_rendezvous … Permission
  denied` crash.
- **`domotion-svg`** — pinned to an exact version in `devDependencies`
  (currently `0.3.3`). The pin is deliberate: this script relies on domotion's
  glyph **path-outline** text rendering, which produces an SVG that looks
  identical on any viewer regardless of installed fonts. domotion `0.4.x`
  changed the default text mode to "embedded-font" — keep the pin until that
  mode is verified to render correctly in this pipeline before bumping. The
  capture asserts path mode (thousands of `<use>` glyphs) and fails loudly if a
  build ever falls back to `<text>`.

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

- The end card is **hand-built SVG**, not captured HTML — domotion's
  `<text>`-fallback path emits computed font-families with inner double-quotes
  (invalid XML); a small sanitizer in `capture-demo.ts` also single-quotes known
  family names as a safety net for any captured frame that falls back.
- The risk badges use mocked (random) scores, so their exact values/order vary
  per run — that's cosmetic; the point is the colored risk triage.
