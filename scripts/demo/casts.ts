/**
 * asciinema-v2 `.cast` generators for the demo's two terminal beats, rendered
 * by `capture-demo.ts` through domotion's `castToTermFrames` (the `domotion term`
 * pipeline) so they read as a REAL terminal session — incremental line reveal, a
 * real caret, hard cuts between settle points — rather than separate HTML
 * screenshots crossfaded together (which looked composited / had unexpected
 * fading).
 *
 * A cast is newline-delimited JSON: a header line `{version:2,width,height}`
 * then `[time, "o", data]` output events. `data` is raw terminal bytes — we emit
 * truecolor ANSI SGR for color. The frame builder derives per-frame durations
 * from the gaps between settle points, so the `pause()`/typing delays here set
 * the on-screen pacing.
 */

// --- asciinema-v2 builder -------------------------------------------------

interface CastEvent { t: number; data: string }

/** A tiny terminal-output script: accumulates timed `o` events, then serializes
 *  to an asciinema-v2 document. Times are seconds-since-start. */
class CastWriter {
  private t = 0;
  private readonly events: CastEvent[] = [];
  constructor(readonly cols: number, readonly rows: number) {}

  /** Advance the clock without emitting output (a settle/hold). */
  pause(seconds: number): this {
    this.t += seconds;
    return this;
  }

  /** Emit a chunk of raw terminal bytes at the current time. */
  raw(data: string): this {
    this.events.push({ t: this.t, data });
    return this;
  }

  /** Emit text followed by CRLF. */
  line(text = ''): this {
    return this.raw(`${text}\r\n`);
  }

  /** "Type" text one character at a time (each char its own event), so the
   *  caret slides along and it reads as typed. `cps` = characters/second. */
  type(text: string, cps = 22): this {
    const step = 1 / cps;
    for (const ch of text) {
      this.t += step;
      this.raw(ch);
    }
    return this;
  }

  toString(): string {
    const header = JSON.stringify({ version: 2, width: this.cols, height: this.rows });
    const lines = this.events.map((e) => JSON.stringify([Number(e.t.toFixed(3)), 'o', e.data]));
    return [header, ...lines].join('\n') + '\n';
  }
}

// --- ANSI truecolor helpers (palette mirrors scenes.ts COLOR) -------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
function fg(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}
const C = {
  text: fg('#c9d1d9'),
  dim: fg('#6e7681'),
  terracotta: fg('#e8a87c'), // the ✻ welcome glyph
  command: fg('#79c0ff'), // slash command / URL
  tool: fg('#58a6ff'), // ● action bullets, prompt dir
  toolName: fg('#d2a8ff'), // Read(...) / Update(...) tool names
  add: fg('#3fb950'),
  remove: fg('#f85149'),
} as const;

// === Launch shell: git status + npx glassbox ==============================

/**
 * The opening shell beat: a `git status -s` of the uncommitted work, then the
 * user types `npx glassbox`, and the CLI reports the review it built + the local
 * URL. The files match the demo review (DEMO_FILES in `src/demo/fixtures.ts`) so
 * the launch lines up with the diff shown next — modified (` M`) vs added (`??`).
 */
export function launchCast(cols: number, rows: number): string {
  const c = new CastWriter(cols, rows);
  const prompt = `${C.tool}demo-project${RESET} ${C.dim}%${RESET} `;
  const mod = (p: string) => c.line(`${C.terracotta} M${RESET} ${p}`);
  const add = (p: string) => c.line(`${C.add}??${RESET} ${p}`);

  c.pause(0.4);
  c.raw(prompt).type('git status -s', 26).line();
  c.pause(0.25);
  mod('src/auth/session.ts');
  mod('src/api/routes/users.ts');
  mod('src/middleware/auth.ts');
  mod('src/assets/icons.min.svg');
  mod('package.json');
  add('src/db/redis.ts');
  add('src/utils/password.ts');
  add('tests/auth.test.ts');
  c.line();
  c.pause(0.5);

  c.raw(prompt).type('npx glassbox', 24).line();
  c.pause(0.6);
  c.line(`${BOLD}${C.command}Glassbox${RESET}${C.dim}  ·  reviewing uncommitted changes${RESET}`);
  c.line(`${C.dim}  8 files changed  ·  ${RESET}${C.add}+312${RESET} ${C.remove}-47${RESET}`);
  c.line();
  c.line(`${C.add}✓${RESET} Review ready  ·  ${C.command}http://localhost:4183${RESET}`);
  c.line(`${C.dim}  Opening your browser…${RESET}`);
  c.pause(1.4);
  return c.toString();
}

// === Claude Code /glassbox session ========================================

const OLD_LINE = "  await redis.set(`session:${id}`, JSON.stringify(session), 'EX', SESSION_TTL);";
const NEW_LINE = "  await redis.set(`session:${encodeURIComponent(id)}`, JSON.stringify(session), 'EX', SESSION_TTL);";

/**
 * The Claude Code half: the user runs `/glassbox`, Claude reads the exported
 * review, explains the bug, applies the URL-encoding fix (the same change the
 * loop-closing Glassbox frame shows), and runs the tests. A faithful static
 * recreation of the real TUI (welcome box, `●` action bullets, `⎿` results,
 * `Read(...)`/`Update(...)` tool calls, an inline edit diff).
 */
export function claudeCast(cols: number, rows: number): string {
  const c = new CastWriter(cols, rows);
  const bullet = `${C.tool}●${RESET}`;
  const tool = (name: string, arg: string) => `${C.toolName}${name}${RESET}(${C.dim}${arg}${RESET})`;
  const result = (text: string) => c.line(`${C.dim}  ⎿  ${text}${RESET}`);

  // Welcome box (rounded, like the real Claude Code banner). A fixed inner width
  // (not the full terminal) keeps it compact and the right border straight. Each
  // row is `│ ` + content (padded to `inner`) + ` │`, so total width = inner + 4
  // exactly matches the `╭`/`╰` border row.
  const inner = 46;
  const bar = '─'.repeat(inner + 2);
  // `visibleLen` is the printed-glyph count of `content` (ANSI codes don't print).
  const boxLine = (content: string, visibleLen: number) =>
    c.line(`${C.dim}│${RESET} ${content}${' '.repeat(Math.max(0, inner - visibleLen))} ${C.dim}│${RESET}`);
  c.pause(0.3);
  c.line(`${C.dim}╭${bar}╮${RESET}`);
  boxLine(`${C.terracotta}✻${RESET} ${BOLD}Welcome to Claude Code${RESET}`, '✻ Welcome to Claude Code'.length);
  boxLine('', 0);
  boxLine(`${C.dim}  /help for help, /status for your account${RESET}`, '  /help for help, /status for your account'.length);
  boxLine('', 0);
  boxLine(`${C.dim}  cwd: ~/projects/demo-project${RESET}`, '  cwd: ~/projects/demo-project'.length);
  c.line(`${C.dim}╰${bar}╯${RESET}`);
  c.line();

  // Prompt + typed /glassbox.
  c.raw(`${C.dim}>${RESET} `).type('/glassbox', 20);
  c.raw(`${C.command}`); // color the just-typed command
  c.pause(0.7);
  c.raw(RESET).line();
  c.line();

  // Claude reads the review and explains.
  c.line(`${bullet} I'll read the latest Glassbox review and apply the feedback.`);
  c.pause(0.5);
  c.line(`${bullet} ${tool('Read', '.glassbox/latest-review.md')}`);
  result('Read 14 lines · 1 annotation (bug) on src/auth/session.ts');
  c.pause(0.4);
  c.line(`${bullet} ${tool('Read', 'src/auth/session.ts')}`);
  result('Read 33 lines');
  c.pause(0.5);
  c.line(`${bullet} Line 23 interpolates the session id straight into the Redis key. An id`);
  c.line(`  containing a colon could collide with the key namespace — I'll URL-encode it.`);
  c.pause(0.7);

  // Apply the fix.
  c.line(`${bullet} ${tool('Update', 'src/auth/session.ts')}`);
  result('Updated src/auth/session.ts with 1 addition and 1 removal');
  c.line(`${C.dim}    21${RESET}     refreshToken,`);
  c.line(`${C.dim}    22${RESET}   };`);
  c.line(`${C.remove}    23  -${RESET}${C.remove}${OLD_LINE}${RESET}`);
  c.line(`${C.add}    23  +${RESET}${C.add}${NEW_LINE}${RESET}`);
  c.line(`${C.dim}    24${RESET}   return session;`);
  c.pause(0.6);

  // Tests pass.
  c.line(`${bullet} ${tool('Bash', 'npm test')}`);
  result(`${C.add}✓${RESET}${C.dim} 18 passed (1.2s)`);
  c.pause(0.5);
  c.line(`${bullet} Done — the session id is URL-encoded before it reaches the Redis key,`);
  c.line(`  and tests pass.`);
  c.pause(1.6);
  return c.toString();
}
