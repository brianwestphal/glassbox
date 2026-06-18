/**
 * On-disk store for review notes (docs/20 §20.1). Layout (SRC is the
 * repo-relative source path):
 *
 *   .pr-notes/notes/SRC.NNNNNN.sarif
 *
 * Sharded **by source-file path** (not by commit/date) because the dominant
 * read is "give me the notes for the files in this review" — Glassbox reads
 * exactly the changed files' note files, never a full scan, even at millions of
 * total records. A per-file 6-digit shard index caps any single file's notes at
 * `DEFAULT_SHARD_CAP` results and rolls to the next index when full, bounding
 * the size for hot, frequently-edited files. Within a shard, results are grouped
 * into SARIF runs by (producer, baseline commit) so `versionControlProvenance`
 * stays accurate per-run using only standard SARIF.
 */
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { generateId } from '../db/ids.js';
import type { SarifLog, SarifRun } from './sarif.js';
import { buildResult, emptyLog, newRun, SarifLogShapeSchema } from './sarif.js';
import type { ReviewNoteInput } from './types.js';
import { DEFAULT_PRODUCER, DEFAULT_SHARD_CAP } from './types.js';

const NOTES_SUBDIR = join('.pr-notes', 'notes');
const SHARD_RE = /\.(\d{6})\.sarif$/;

/** Normalize a repo-relative path: forward slashes, no leading slash, and any
 *  parent-escaping segment neutralized so a note can only ever write inside
 *  `.pr-notes/`. */
function sanitizeRel(file: string): string {
  const rel = file
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/(^|\/)\.\.(?=\/|$)/g, '$1_');
  return rel === '' ? 'file' : rel;
}

function shardPath(repoRoot: string, safeRel: string, index: number): string {
  return join(repoRoot, NOTES_SUBDIR, `${safeRel}.${String(index).padStart(6, '0')}.sarif`);
}

/** Existing shard indices for a source path, ascending. */
function listShardIndices(repoRoot: string, safeRel: string): number[] {
  const dir = join(repoRoot, NOTES_SUBDIR, dirname(safeRel));
  if (!existsSync(dir)) return [];
  const base = safeRel.split('/').pop() ?? safeRel;
  const indices: number[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.startsWith(base + '.')) continue;
    const m = SHARD_RE.exec(entry);
    if (m !== null && entry === `${base}.${m[1]}.sarif`) indices.push(parseInt(m[1], 10));
  }
  return indices.sort((a, b) => a - b);
}

function totalResults(log: SarifLog): number {
  return log.runs.reduce((sum, run) => sum + run.results.length, 0);
}

function readLog(path: string): SarifLog {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  const parsed = SarifLogShapeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`existing notes shard is not a SARIF log we recognize, refusing to overwrite: ${path}`);
  }
  // Return the raw object (not the stripped parse) so unknown fields any other
  // producer wrote survive the round-trip; we only push into runs[].results.
  return raw as SarifLog;
}

/** Find the run for this (producer, baseline commit) pair, or add one. Keeps
 *  `versionControlProvenance` accurate even as a shard accumulates notes from
 *  different commits. */
function findOrAddRun(log: SarifLog, producer: string, producerVersion: string | undefined, vcs: {
  revisionId?: string; branch?: string; repositoryUri?: string;
}): SarifRun {
  const existing = log.runs.find(run =>
    run.tool.driver.name === producer &&
    run.tool.driver.version === producerVersion &&
    (run.versionControlProvenance?.[0]?.revisionId ?? undefined) === vcs.revisionId);
  if (existing !== undefined) return existing;
  const run = newRun(producer, { producerVersion, ...vcs });
  log.runs.push(run);
  return run;
}

function gitValue(repoRoot: string, args: string[]): string | undefined {
  try {
    const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
    if (res.status !== 0) return undefined;
    const out = res.stdout.trim();
    return out === '' ? undefined : out;
  } catch {
    return undefined;
  }
}

/** Snippet + content fingerprint of the anchored lines, read from the current
 *  file. Used now for the snippet and for P3 re-anchoring. Best-effort: returns
 *  empty if the file/lines can't be read. */
function anchorSnippet(repoRoot: string, safeRel: string, startLine: number, endLine: number): {
  snippet?: string; fingerprint?: string;
} {
  try {
    const lines = readFileSync(join(repoRoot, safeRel), 'utf-8').split('\n');
    const slice = lines.slice(Math.max(0, startLine - 1), Math.max(startLine, endLine));
    if (slice.length === 0) return {};
    const snippet = slice.join('\n');
    const normalized = slice.map(l => l.trim().replace(/\s+/g, ' ')).join('\n');
    const fingerprint = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    return { snippet, fingerprint };
  } catch {
    return {};
  }
}

/** Warn (stderr) if `.pr-notes/` is gitignored — an ignored notes dir silently
 *  defeats the feature (docs/20 §20.1). Best-effort. */
export function warnIfPrNotesIgnored(repoRoot: string): void {
  try {
    const res = spawnSync('git', ['check-ignore', '.pr-notes'], { cwd: repoRoot, encoding: 'utf-8' });
    if (res.status === 0) {
      console.error('Warning: .pr-notes/ appears to be gitignored. Review notes must be committed to be useful — remove it from .gitignore.');
    }
  } catch { /* not a repo / git unavailable — best-effort */ }
}

/**
 * Write a review note into the appropriate `.pr-notes/` shard. Returns the
 * shard path written and the note's guid.
 */
export function writeReviewNote(repoRoot: string, input: ReviewNoteInput, opts: { cap?: number } = {}): {
  path: string; guid: string;
} {
  const cap = opts.cap ?? DEFAULT_SHARD_CAP;
  const safeRel = sanitizeRel(input.file);
  const producer = input.producer ?? DEFAULT_PRODUCER;

  const vcs = {
    revisionId: gitValue(repoRoot, ['rev-parse', 'HEAD']),
    branch: gitValue(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    repositoryUri: gitValue(repoRoot, ['config', '--get', 'remote.origin.url']),
  };
  const { snippet, fingerprint } = anchorSnippet(repoRoot, safeRel, input.startLine, input.endLine);
  const guid = generateId();
  const result = buildResult({ ...input, file: safeRel }, { guid, snippet, fingerprint });

  // Pick the shard: the highest existing index with room, else the next index.
  const indices = listShardIndices(repoRoot, safeRel);
  let index = indices.length > 0 ? indices[indices.length - 1] : 0;
  let path = shardPath(repoRoot, safeRel, index);
  let log: SarifLog;
  if (existsSync(path)) {
    log = readLog(path);
    if (totalResults(log) >= cap) {
      index += 1;
      path = shardPath(repoRoot, safeRel, index);
      log = emptyLog(producer, { producerVersion: input.producerVersion, ...vcs });
    }
  } else {
    log = emptyLog(producer, { producerVersion: input.producerVersion, ...vcs });
  }

  findOrAddRun(log, producer, input.producerVersion, vcs).results.push(result);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(log, null, 2) + '\n', 'utf-8');
  return { path, guid };
}
