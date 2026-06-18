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

import { warnIfPrNotesIgnored, writeReviewNote } from './store.js';
import type { NoteKind, ReviewNoteInput } from './types.js';
import { isNoteKind, NOTE_KINDS } from './types.js';

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
  body?: string;
  bodyStdin: boolean;
}

function noteUsage(): string {
  return `glassbox note — write an AI-authored, line-anchored review note (docs/20)

Usage:
  glassbox note add --file <path> --lines <A[-B]> --kind <kind> --body <text|->  [options]

Required:
  --file <path>     Source file the note anchors to (relative to cwd or absolute)
  --lines <A[-B]>   1-based line or line range (e.g. 42 or 42-50)
  --kind <kind>     One of: ${NOTE_KINDS.join(', ')}
  --body <text|->   Markdown body; pass - to read the body from stdin

Options:
  --confidence <0..1>   Author confidence
  --rank <0..100>       Importance
  --ticket <id|url>     Linked ticket
  --producer <name>     Producing tool/agent (e.g. "Claude Code", "Hot Sheet")
  --producer-version <v>
`;
}

function parseInteger(label: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer, got "${value}"`);
  return n;
}

/** Parse `note add` flags. Pure (no I/O) so it can be unit-tested directly. */
export function parseNoteAdd(args: string[]): ParsedAdd {
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

  const parsed: ParsedAdd = { file, startLine, endLine, kind: kindRaw, bodyStdin: false };

  const confidence = flags.get('confidence');
  if (confidence !== undefined) {
    const c = Number(confidence);
    if (Number.isNaN(c) || c < 0 || c > 1) throw new Error('--confidence must be between 0 and 1');
    parsed.confidence = c;
  }
  const rank = flags.get('rank');
  if (rank !== undefined) {
    const r = Number(rank);
    if (!Number.isInteger(r) || r < 0 || r > 100) throw new Error('--rank must be an integer 0..100');
    parsed.rank = r;
  }
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

/** Entry point for `glassbox note ...`. Throws on error (caller maps to exit 1).
 *  `ctx.cwd` is injectable for testing. */
export async function runNoteCli(args: string[], ctx: { cwd?: string } = {}): Promise<void> {
  const cwd = ctx.cwd ?? process.cwd();
  const sub = args.at(0);
  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(noteUsage());
    return;
  }
  if (sub !== 'add') throw new Error(`unknown 'note' subcommand: ${sub} (expected 'add')`);

  const parsed = parseNoteAdd(args.slice(1));
  const body = parsed.bodyStdin ? await readStdin() : parsed.body;
  if (body === undefined || body.trim() === '') {
    throw new Error('note body is empty');
  }

  const repoRoot = findRepoRoot(cwd);
  const fileRel = toRepoRelative(repoRoot, cwd, parsed.file);
  const input: ReviewNoteInput = {
    file: fileRel,
    startLine: parsed.startLine,
    endLine: parsed.endLine,
    body,
    kind: parsed.kind,
    confidence: parsed.confidence,
    rank: parsed.rank,
    ticket: parsed.ticket,
    producer: parsed.producer,
    producerVersion: parsed.producerVersion,
  };

  warnIfPrNotesIgnored(repoRoot);
  const { path, guid } = writeReviewNote(repoRoot, input);
  console.log(`Wrote review note ${guid} -> ${relative(repoRoot, path)}`);
}
