/**
 * Builds a self-contained HTML recreation of the Claude Code terminal, used by
 * `capture-demo.ts` as the second half of the Glassbox demo SVG.
 *
 * This is NOT a real Claude Code session — it is a faithful static mock styled
 * to match the real TUI (welcome box, `●` action bullets, `⎿` tool results,
 * `Read(...)` / `Update(...)` tool calls, an inline edit diff). Its `/glassbox`
 * flow mirrors what the live channel integration actually does: read
 * `.glassbox/latest-review.md` and apply the annotated fix. The fix shown here
 * (URL-encoding the Redis session key) is the same change the loop-closing
 * Glassbox frame depicts, so the two halves line up.
 *
 * Rendered headlessly by Playwright and captured by domotion, so it only needs
 * to look right at the capture viewport size — no client JS, no interactivity.
 */

import { CARD } from './chrome.js';

/** How much of the session to reveal. The capture script renders all three. */
export type TerminalStage = 'prompt' | 'working' | 'done';

export interface TerminalSceneOptions {
  /** Capture viewport width in CSS px. */
  width: number;
  /** Capture viewport height in CSS px. */
  height: number;
  stage: TerminalStage;
}

// Claude Code terminal palette (GitHub-dark-adjacent, reads on the same
// background as the diff colors used in the Edit block).
const COLOR = {
  bg: '#0d1117',
  text: '#c9d1d9',
  dim: '#6e7681',
  welcome: '#e8a87c', // the ✻ glyph — Claude's terracotta
  border: '#30363d',
  command: '#79c0ff', // slash command
  tool: '#58a6ff', // ● action bullets
  toolName: '#d2a8ff', // Read(...) / Update(...) tool names
  add: '#3fb950',
  remove: '#f85149',
  addBg: 'rgba(63,185,80,0.15)',
  removeBg: 'rgba(248,81,73,0.15)',
} as const;

/** The id the typing overlay anchors to (the empty command slot after `> `). */
export const PROMPT_ANCHOR_ID = 'demo-prompt-anchor';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A `●` assistant action line. `tool` highlights a `Name(arg)` tool call. */
function actionLine(html: string): string {
  return `<div class="line"><span class="tool">●</span> ${html}</div>`;
}

function toolCall(name: string, arg: string): string {
  return `<span class="toolname">${esc(name)}</span>(<span class="dim">${esc(arg)}</span>)`;
}

/** The `⎿` result connector under a tool call. */
function resultLine(text: string): string {
  return `<div class="line dim">  ⎿  ${esc(text)}</div>`;
}

/** A plain assistant prose line (wraps at the terminal column width). */
function proseLine(text: string): string {
  return `<div class="line prose"><span class="tool">●</span> ${esc(text)}</div>`;
}

/** One row of the inline Edit diff (numbered, +/- gutter). */
function diffRow(kind: 'add' | 'remove' | 'context', num: number, code: string): string {
  const sign = kind === 'add' ? '+' : kind === 'remove' ? '-' : ' ';
  return (
    `<div class="diffrow ${kind}">` +
    `<span class="num">${String(num)}</span>` +
    `<span class="sign">${sign}</span>` +
    `<span class="dcode">${esc(code)}</span>` +
    `</div>`
  );
}

function welcomeBox(): string {
  return (
    `<div class="welcome">` +
    `<div class="line"><span class="star">✻</span> <b>Welcome to Claude Code</b></div>` +
    `<div class="line dim">&nbsp;</div>` +
    `<div class="line dim">&nbsp;&nbsp;/help for help, /status for your account</div>` +
    `<div class="line dim">&nbsp;</div>` +
    `<div class="line dim">&nbsp;&nbsp;cwd: ~/projects/demo-project</div>` +
    `</div>`
  );
}

function promptLine(stage: TerminalStage): string {
  if (stage === 'prompt') {
    // Empty command slot — the typing overlay paints `/glassbox` here.
    return `<div class="line prompt"><span class="caret">&gt;</span> <span id="${PROMPT_ANCHOR_ID}"></span></div>`;
  }
  return `<div class="line prompt"><span class="caret">&gt;</span> <span class="command">/glassbox</span></div>`;
}

const OLD_LINE = "  await redis.set(`session:${id}`, JSON.stringify(session), 'EX', SESSION_TTL);";
const NEW_LINE = "  await redis.set(`session:${encodeURIComponent(id)}`, JSON.stringify(session), 'EX', SESSION_TTL);";

function body(stage: TerminalStage): string {
  const parts: string[] = [welcomeBox(), `<div class="gap"></div>`, promptLine(stage)];

  if (stage === 'working' || stage === 'done') {
    parts.push(`<div class="gap"></div>`);
    parts.push(proseLine("I'll read the latest Glassbox review and apply the feedback."));
    parts.push(`<div class="gap-sm"></div>`);
    parts.push(actionLine(toolCall('Read', '.glassbox/latest-review.md')));
    parts.push(resultLine('Read 14 lines · 1 annotation (bug) on src/auth/session.ts'));
    parts.push(actionLine(toolCall('Read', 'src/auth/session.ts')));
    parts.push(resultLine('Read 33 lines'));
    parts.push(`<div class="gap-sm"></div>`);
    parts.push(
      proseLine(
        'Line 23 interpolates the session id straight into the Redis key. An id containing a colon could collide with the key namespace — I\'ll URL-encode it.',
      ),
    );
  }

  if (stage === 'done') {
    parts.push(`<div class="gap-sm"></div>`);
    parts.push(actionLine(toolCall('Update', 'src/auth/session.ts')));
    parts.push(resultLine('Updated src/auth/session.ts with 1 addition and 1 removal'));
    parts.push(`<div class="diff">`);
    parts.push(diffRow('context', 21, '    refreshToken,'));
    parts.push(diffRow('context', 22, '  };'));
    parts.push(diffRow('remove', 23, OLD_LINE));
    parts.push(diffRow('add', 23, NEW_LINE));
    parts.push(diffRow('context', 24, '  return session;'));
    parts.push(`</div>`);
    parts.push(`<div class="gap-sm"></div>`);
    parts.push(actionLine(toolCall('Bash', 'npm test')));
    parts.push(resultLine('✓ 18 passed (1.2s)'));
    parts.push(`<div class="gap-sm"></div>`);
    parts.push(proseLine('Done — the session id is URL-encoded before it reaches the Redis key, and tests pass.'));
  }

  return parts.join('\n');
}

export function terminalSceneHtml(opts: TerminalSceneOptions): string {
  const { width, height, stage } = opts;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${String(width)}px;
    height: ${String(height)}px;
    background: ${COLOR.bg};
    color: ${COLOR.text};
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace;
    font-size: 14px;
    line-height: 1.55;
    overflow: hidden;
  }
  .term { padding: 32px 40px; max-width: 1000px; }
  .line { white-space: pre-wrap; }
  .prose { padding-left: 0; }
  .gap { height: 16px; }
  .gap-sm { height: 8px; }
  .dim { color: ${COLOR.dim}; }
  b { font-weight: 600; }
  .welcome {
    border: 1px solid ${COLOR.border};
    border-radius: 8px;
    padding: 12px 16px;
    max-width: 560px;
  }
  .star { color: ${COLOR.welcome}; }
  .prompt .caret { color: ${COLOR.dim}; }
  .command { color: ${COLOR.command}; }
  .tool { color: ${COLOR.tool}; font-weight: 700; }
  .toolname { color: ${COLOR.toolName}; }
  .diff { margin: 6px 0 0 18px; }
  .diffrow { white-space: pre; display: flex; }
  .diffrow .num { color: ${COLOR.dim}; width: 34px; text-align: right; padding-right: 12px; user-select: none; }
  .diffrow .sign { width: 14px; }
  .diffrow.add { background: ${COLOR.addBg}; }
  .diffrow.add .sign, .diffrow.add .dcode { color: ${COLOR.add}; }
  .diffrow.remove { background: ${COLOR.removeBg}; }
  .diffrow.remove .sign, .diffrow.remove .dcode { color: ${COLOR.remove}; }
  .diffrow.context .sign, .diffrow.context .dcode { color: ${COLOR.text}; }
</style>
</head>
<body>
  <div class="term">${body(stage)}</div>
</body>
</html>`;
}

// --- Launch terminal -----------------------------------------------------

/** The id the typing overlay anchors to (the empty slot after the `%` prompt). */
export const LAUNCH_ANCHOR_ID = 'demo-launch-anchor';

/** `prompt` = empty command slot (the typing overlay paints `npx glassbox`);
 *  `launched` = command + the CLI launch output. */
export type LaunchStage = 'prompt' | 'launched';

export interface LaunchSceneOptions {
  width: number;
  height: number;
  stage: LaunchStage;
}

/**
 * A faux shell launching Glassbox from the CLI: the user runs `npx glassbox`,
 * the CLI reports the review it built and the local URL, and (composited next
 * to the first app beat via a crossfade) Glassbox "appears" in the browser.
 * Opens the demo so a first-time viewer sees how you start a review.
 */
export function launchTerminalHtml(opts: LaunchSceneOptions): string {
  const { width, height, stage } = opts;
  const cmdSlot =
    stage === 'prompt'
      ? `<span id="${LAUNCH_ANCHOR_ID}"></span>`
      : `<span class="cmd">npx glassbox</span>`;
  // A short scrollback above the command: a `git status` showing the
  // uncommitted work, so the launch reads as "review these changes". Identical
  // in both stages so the typed `npx glassbox` line stays put across the
  // crossfade.
  const preamble =
    `<div class="line"><span class="dir">demo-project</span> <span class="pct">%</span> <span class="cmd">git status -s</span></div>` +
    `<div class="line status"><span class="mod"> M</span> src/auth/session.ts</div>` +
    `<div class="line status"><span class="mod"> M</span> src/db/redis.ts</div>` +
    `<div class="line status"><span class="mod"> M</span> src/api/users.ts</div>` +
    `<div class="line status"><span class="new">??</span> src/auth/mfa.ts</div>` +
    `<div class="gap-sm"></div>`;
  const prompt =
    preamble +
    `<div class="line"><span class="dir">demo-project</span> <span class="pct">%</span> ${cmdSlot}</div>`;

  const output =
    stage === 'launched'
      ? `<div class="gap"></div>` +
        `<div class="line"><span class="brand">Glassbox</span><span class="dim">  ·  reviewing uncommitted changes</span></div>` +
        `<div class="line dim">  8 files changed  ·  <span class="add">+312</span> <span class="rm">-47</span></div>` +
        `<div class="gap-sm"></div>` +
        `<div class="line"><span class="ok">✓</span> Review ready  ·  <span class="url">http://localhost:4183</span></div>` +
        `<div class="line dim">  Opening your browser…</div>`
      : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${String(width)}px; height: ${String(height)}px;
    background: ${COLOR.bg}; color: ${COLOR.text}; overflow: hidden;
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace;
    font-size: 15px; line-height: 1.7;
  }
  .term { padding: 36px 44px; }
  .line { white-space: pre-wrap; }
  .gap { height: 18px; }
  .gap-sm { height: 9px; }
  .dim { color: ${COLOR.dim}; }
  .dir { color: ${COLOR.tool}; font-weight: 600; }
  .pct { color: ${COLOR.dim}; }
  .cmd { color: ${COLOR.text}; }
  .status { color: ${COLOR.dim}; }
  .status .mod { color: ${COLOR.welcome}; }
  .status .new { color: ${COLOR.add}; }
  .brand { color: ${COLOR.command}; font-weight: 700; }
  .add { color: ${COLOR.add}; }
  .rm { color: ${COLOR.remove}; }
  .ok { color: ${COLOR.add}; font-weight: 700; }
  .url { color: ${COLOR.command}; text-decoration: underline; text-underline-offset: 2px; }
</style></head>
<body><div class="term">${prompt}${output}</div></body></html>`;
}

// --- Markdown peek -------------------------------------------------------

/** Lightweight line-based markdown → HTML for the exported-review peek. Not a
 *  full parser — just enough to read the structure faithfully. */
function renderMarkdown(md: string, maxLines: number): string {
  const inline = (s: string): string =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<span class="code">$1</span>');
  const out: string[] = [];
  for (const raw of md.split('\n').slice(0, maxLines)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') out.push('<div class="mdgap"></div>');
    else if (line.startsWith('### ')) out.push(`<div class="h3">${inline(line.slice(4))}</div>`);
    else if (line.startsWith('## ')) out.push(`<div class="h2">${inline(line.slice(3))}</div>`);
    else if (line.startsWith('# ')) out.push(`<div class="h1">${inline(line.slice(2))}</div>`);
    else if (line.startsWith('> ')) out.push(`<div class="quote">${inline(line.slice(2))}</div>`);
    else if (line.startsWith('---')) out.push(`<div class="hr"></div>`);
    else if (/^[-*] /.test(line)) out.push(`<div class="li">${inline(line.slice(2))}</div>`);
    else out.push(`<div class="p">${inline(line)}</div>`);
  }
  return out.join('\n');
}

export interface MarkdownPeekOptions {
  width: number;
  height: number;
  markdown: string;
}

/** A faux file view of the exported `.glassbox/latest-review.md`. */
export function markdownPeekHtml(opts: MarkdownPeekOptions): string {
  const { width, height, markdown } = opts;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${String(width)}px; height: ${String(height)}px;
    background: ${COLOR.bg}; color: ${COLOR.text}; overflow: hidden;
    font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 14px; line-height: 1.6;
  }
  .doc { padding: 40px 56px; }
  .h1 { font-size: 26px; font-weight: 700; color: ${COLOR.text}; margin-bottom: 4px; }
  .h2 { font-size: 18px; font-weight: 700; color: ${COLOR.command}; margin: 18px 0 4px; }
  .h3 { font-size: 15px; font-weight: 600; color: ${COLOR.toolName}; margin: 12px 0 2px; }
  .li { padding-left: 18px; text-indent: -18px; color: ${COLOR.text}; }
  .li::before { content: "•  "; color: ${COLOR.dim}; }
  .p { color: ${COLOR.text}; }
  .quote { color: ${COLOR.dim}; font-style: italic; border-left: 3px solid ${COLOR.border}; padding-left: 12px; }
  .code { color: ${COLOR.add}; }
  .mdgap { height: 9px; }
  .hr { height: 1px; background: ${COLOR.border}; margin: 14px 0; }
  b { color: ${COLOR.welcome}; font-weight: 600; }
</style></head>
<body><div class="doc">${renderMarkdown(markdown, 34)}</div></body></html>`;
}

// --- End card ------------------------------------------------------------

/** Branded closing card as hand-built SVG markup. Floats as a rounded card in
 *  the same window-frame rect as the captured beats (transparent outside it), so
 *  the outro matches the floating-window aesthetic. Hand-built so its text uses
 *  valid single-quoted font-families and never trips domotion's
 *  `<text>`-fallback double-quote bug. Renders in the viewer's system font —
 *  fine for branding. */
export function endCardSvg(): string {
  const { x, y, w, h, r } = CARD;
  const cx = x + w / 2;
  const sans = "-apple-system, 'Segoe UI', system-ui, sans-serif";
  const mono = "ui-monospace, 'SF Mono', Menlo, monospace";
  // Center the branding block within the card.
  const yMark = Math.round(y + h / 2 - 84);
  const pillW = 232;
  const pillX = Math.round(cx - pillW / 2);
  const pillY = yMark + 132;
  return (
    `<defs><linearGradient id="endbg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#19223400"/><stop offset="0.55" stop-color="#0b0e14"/></linearGradient></defs>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#0b0e14"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#172033"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="url(#endbg)"/>` +
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r - 0.5}" ry="${r - 0.5}" ` +
    `fill="none" stroke="#ffffff" stroke-opacity="0.10"/>` +
    `<text x="${cx}" y="${yMark}" text-anchor="middle" font-family="${sans}" font-size="70" font-weight="700" ` +
    `letter-spacing="-1.5" fill="#f0f4fa">Glass<tspan fill="#79c0ff">box</tspan></text>` +
    `<text x="${cx}" y="${yMark + 52}" text-anchor="middle" font-family="${sans}" font-size="24" fill="#aab4c2">` +
    `Review AI-generated code. Annotate. Let your AI apply the fix.</text>` +
    `<text x="${cx}" y="${yMark + 90}" text-anchor="middle" font-family="${sans}" font-size="13" ` +
    `letter-spacing="3" fill="#6e7681">↻&#160;&#160;THE REVIEW LOOP</text>` +
    `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="50" rx="11" fill="#1b2230" stroke="#30384a"/>` +
    `<text x="${cx}" y="${pillY + 32}" text-anchor="middle" font-family="${mono}" font-size="19" fill="#e8edf4">` +
    `<tspan fill="#3fb950">$</tspan> npx glassbox</text>` +
    `<text x="${cx}" y="${pillY + 92}" text-anchor="middle" font-family="${sans}" font-size="16" fill="#8b96a6">` +
    `github.com/brianwestphal/glassbox</text>`
  );
}
