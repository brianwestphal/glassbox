/**
 * `glassbox note` — the producer-side writer for AI-Authored Review Notes
 * (docs/20 §20.4). A producer (Claude Code, Hot Sheet, any AI tool) shells out
 * to this as it edits code; it owns the SARIF shape, fingerprinting, baseline
 * provenance, and the `.pr-notes/` layout so producers can't get them wrong.
 * This is the reference implementation of the on-disk format; tools that can't
 * shell out can write the SARIF directly per the spec.
 */
import { spawnSync } from 'child_process';
import { relative, resolve } from 'path';

import { reviewNoteInstructions } from './instructions.js';
import type { NotePatch } from './store.js';
import { coalesceAll, coalesceFile, removeNote, updateNote, warnIfPrNotesIgnored, writeReviewNote } from './store.js';
import type { NoteKind, ReviewNoteInput } from './types.js';
import { isNoteKind, NOTE_KINDS } from './types.js';

/** Parse `--flag value` pairs into a map. Throws on a flag with no value. */
function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const next = args.at(i + 1);
    if (next === undefined || next.startsWith('--')) throw new Error(`missing value for --${key}`);
    flags.set(key, next);
    i++;
  }
  return flags;
}

interface ParsedAdd {
  file: string;
  startLine: number;
  endLine: number;
  kind: NoteKind;
  confidence?: number;
  rank?: number;
  ticket?: string;
  producer?: string;
  producerVersion?: string;
  artifacts: string[];
  body?: string;
  bodyStdin: boolean;
}

/** All values for a repeatable `--flag value` (e.g. `--artifact`). */
function collectRepeatable(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) {
      const v = args.at(i + 1);
      if (v !== undefined && !v.startsWith('--')) out.push(v);
    }
  }
  return out;
}

function noteUsage(): string {
  return `glassbox note — AI-authored, line-anchored review notes (docs/20)

Usage:
  glassbox note add      --file <path> --lines <A[-B]> --kind <kind> --body <text|-> [options]
  glassbox note update   --id <guid> [--file <path>] [--body <text|->] [--kind <kind>] [--confidence <0..1>] [--rank <0..100>] [--ticket <id>]
  glassbox note remove   --id <guid> [--file <path>]
  glassbox note coalesce [--file <path>]
  glassbox note instructions   Print the inbound AI-instructions contract (for orchestrators to inject)

add — required:
  --file <path>     Source file the note anchors to (relative to cwd or absolute)
  --lines <A[-B]>   1-based line or line range (e.g. 42 or 42-50)
  --kind <kind>     One of: ${NOTE_KINDS.join(', ')}
  --body <text|->   Markdown body; pass - to read the body from stdin

add — options:
  --confidence <0..1>   Author confidence
  --rank <0..100>       Importance
  --ticket <id|url>     Linked ticket
  --producer <name>     Producing tool/agent (e.g. "Claude Code", "Hot Sheet")
  --producer-version <v>
  --artifact <path>     Attach a committed proof artifact (test output, log,
                        diagram source); repeatable, repo-relative path

update/remove use the guid returned by 'add' (--file scopes the search; omit to search all notes).
coalesce drops redundant notes (identical anchor + kind + body), keeping the most recent.
`;
}

function parseInteger(label: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer, got "${value}"`);
  return n;
}

/** Parse + validate the shared `--confidence` (0..1) and `--rank` (0..100 int)
 *  flags, used identically by `note add` and `note update`. */
function parseConfidenceRank(flags: Map<string, string>): { confidence?: number; rank?: number } {
  const out: { confidence?: number; rank?: number } = {};
  const confidence = flags.get('confidence');
  if (confidence !== undefined) {
    const c = Number(confidence);
    if (Number.isNaN(c) || c < 0 || c > 1) throw new Error('--confidence must be between 0 and 1');
    out.confidence = c;
  }
  const rank = flags.get('rank');
  if (rank !== undefined) {
    const r = Number(rank);
    if (!Number.isInteger(r) || r < 0 || r > 100) throw new Error('--rank must be an integer 0..100');
    out.rank = r;
  }
  return out;
}

/** Parse `note add` flags. Pure (no I/O) so it can be unit-tested directly. */
export function parseNoteAdd(args: string[]): ParsedAdd {
  const flags = parseFlags(args);

  const file = flags.get('file');
  const lines = flags.get('lines');
  const kindRaw = flags.get('kind');
  if (file === undefined) throw new Error('--file is required');
  if (lines === undefined) throw new Error('--lines is required');
  if (kindRaw === undefined) throw new Error('--kind is required');
  if (!isNoteKind(kindRaw)) throw new Error(`--kind must be one of: ${NOTE_KINDS.join(', ')}`);

  const lineMatch = /^(\d+)(?:-(\d+))?$/.exec(lines);
  if (lineMatch === null) throw new Error(`--lines must be A or A-B (e.g. 42 or 42-50), got "${lines}"`);
  const startLine = parseInteger('--lines start', lineMatch[1]);
  const endRaw = lineMatch.at(2);
  const endLine = endRaw !== undefined ? parseInteger('--lines end', endRaw) : startLine;
  if (startLine < 1 || endLine < startLine) throw new Error('--lines must be 1-based with start <= end');

  const parsed: ParsedAdd = { file, startLine, endLine, kind: kindRaw, artifacts: collectRepeatable(args, 'artifact'), bodyStdin: false };

  Object.assign(parsed, parseConfidenceRank(flags));
  if (flags.has('ticket')) parsed.ticket = flags.get('ticket');
  if (flags.has('producer')) parsed.producer = flags.get('producer');
  if (flags.has('producer-version')) parsed.producerVersion = flags.get('producer-version');

  const body = flags.get('body');
  if (body === undefined) throw new Error('--body is required (text, or - to read stdin)');
  if (body === '-') parsed.bodyStdin = true;
  else parsed.body = body;

  return parsed;
}

function readStdin(): Promise<string> {
  return new Promise((res, rej) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += String(chunk); });
    process.stdin.on('end', () => { res(data); });
    process.stdin.on('error', rej);
  });
}

/** Resolve the repo root (for `.pr-notes/` placement); falls back to cwd. */
function findRepoRoot(cwd: string): string {
  try {
    const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf-8' });
    if (res.status === 0) {
      const top = res.stdout.trim();
      if (top !== '') return top;
    }
  } catch { /* not a repo — fall back to cwd */ }
  return cwd;
}

/** Convert a user-supplied path to a repo-relative, forward-slashed path,
 *  rejecting anything outside the repo. */
function toRepoRelative(repoRoot: string, cwd: string, file: string): string {
  const abs = resolve(cwd, file);
  const rel = relative(repoRoot, abs).replace(/\\/g, '/');
  if (rel === '' || rel.startsWith('../')) {
    throw new Error(`--file must be inside the repository: ${file}`);
  }
  return rel;
}

async function runAdd(args: string[], cwd: string): Promise<void> {
  const parsed = parseNoteAdd(args);
  const body = parsed.bodyStdin ? await readStdin() : parsed.body;
  if (body === undefined || body.trim() === '') throw new Error('note body is empty');

  const repoRoot = findRepoRoot(cwd);
  const input: ReviewNoteInput = {
    file: toRepoRelative(repoRoot, cwd, parsed.file),
    startLine: parsed.startLine,
    endLine: parsed.endLine,
    body,
    kind: parsed.kind,
    confidence: parsed.confidence,
    rank: parsed.rank,
    ticket: parsed.ticket,
    producer: parsed.producer,
    producerVersion: parsed.producerVersion,
    artifacts: parsed.artifacts.length > 0 ? parsed.artifacts : undefined,
  };
  warnIfPrNotesIgnored(repoRoot);
  const { path, guid } = writeReviewNote(repoRoot, input);
  console.log(`Wrote review note ${guid} -> ${relative(repoRoot, path)}`);
}

/** Optional `--file` scopes a guid lookup to one file's shards (fast); without
 *  it the whole `.pr-notes/` tree is searched. */
function scopedFile(flags: Map<string, string>, repoRoot: string, cwd: string): string | undefined {
  const file = flags.get('file');
  return file === undefined ? undefined : toRepoRelative(repoRoot, cwd, file);
}

function runRemove(args: string[], cwd: string): void {
  const flags = parseFlags(args);
  const id = flags.get('id');
  if (id === undefined) throw new Error('--id <guid> is required');
  const repoRoot = findRepoRoot(cwd);
  const removed = removeNote(repoRoot, id, scopedFile(flags, repoRoot, cwd));
  if (!removed) throw new Error(`no review note found with id ${id}`);
  console.log(`Removed review note ${id}`);
}

async function runUpdate(args: string[], cwd: string): Promise<void> {
  const flags = parseFlags(args);
  const id = flags.get('id');
  if (id === undefined) throw new Error('--id <guid> is required');

  const patch: NotePatch = {};
  const bodyFlag = flags.get('body');
  if (bodyFlag !== undefined) patch.body = bodyFlag === '-' ? await readStdin() : bodyFlag;
  const kind = flags.get('kind');
  if (kind !== undefined) {
    if (!isNoteKind(kind)) throw new Error(`--kind must be one of: ${NOTE_KINDS.join(', ')}`);
    patch.kind = kind;
  }
  Object.assign(patch, parseConfidenceRank(flags));
  if (flags.has('ticket')) patch.ticket = flags.get('ticket');

  if (Object.keys(patch).length === 0) throw new Error('nothing to update — pass at least one of --body/--kind/--confidence/--rank/--ticket');

  const repoRoot = findRepoRoot(cwd);
  const updated = updateNote(repoRoot, id, patch, scopedFile(flags, repoRoot, cwd));
  if (!updated) throw new Error(`no review note found with id ${id}`);
  console.log(`Updated review note ${id}`);
}

function runCoalesce(args: string[], cwd: string): void {
  const flags = parseFlags(args);
  const repoRoot = findRepoRoot(cwd);
  const file = flags.get('file');
  const removed = file !== undefined
    ? coalesceFile(repoRoot, toRepoRelative(repoRoot, cwd, file))
    : coalesceAll(repoRoot);
  console.log(`Coalesced review notes — removed ${String(removed)} redundant note(s)`);
}

/** Entry point for `glassbox note ...`. Throws on error (caller maps to exit 1).
 *  `ctx.cwd` is injectable for testing. */
export async function runNoteCli(args: string[], ctx: { cwd?: string } = {}): Promise<void> {
  const cwd = ctx.cwd ?? process.cwd();
  const sub = args.at(0);
  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(noteUsage());
    return;
  }
  const rest = args.slice(1);
  switch (sub) {
    case 'add': await runAdd(rest, cwd); return;
    case 'remove': runRemove(rest, cwd); return;
    case 'update': await runUpdate(rest, cwd); return;
    case 'coalesce': runCoalesce(rest, cwd); return;
    case 'instructions': console.log(reviewNoteInstructions()); return;
    default: throw new Error(`unknown 'note' subcommand: ${sub} (expected add/update/remove/coalesce/instructions)`);
  }
}
