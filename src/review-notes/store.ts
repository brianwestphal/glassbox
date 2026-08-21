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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { generateId } from '../db/ids.js';
import { isLfsPointer } from '../utils/lfs.js';
import type { SarifLog, SarifRun } from './sarif.js';
import { buildResult, emptyLog, newRun, noteMessage, SarifLogShapeSchema } from './sarif.js';
import type { NoteKind, RelatedLocation, ReviewNoteInput } from './types.js';
import { CONFIDENCE_PROPERTY_KEY, DEFAULT_PRODUCER, DEFAULT_SHARD_CAP, isNoteKind } from './types.js';
import type { ReviewNoteArtifact, ReviewNoteView } from './view.js';
import { IMAGE_ARTIFACT_RE } from './view.js';

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
  const artifactHashes = hashArtifacts(repoRoot, input.artifacts ?? []);
  const result = buildResult({ ...input, file: safeRel }, { guid, snippet, fingerprint, artifactHashes });
  // Ensure binary artifacts under .pr-notes/artifacts/ are Git LFS-tracked so
  // they don't bloat history (docs/20 §20.5 P4c).
  if ((input.artifacts ?? []).some(a => IMAGE_ARTIFACT_RE.test(a))) ensureArtifactLfsFilter(repoRoot);

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

// --- Edit / coalesce (GB-902) ----------------------------------------------

/** The subset of a SARIF result we read/mutate. A tight cast at the boundary
 *  (the result we ourselves wrote); other fields pass through untouched. */
interface NoteResult {
  guid?: string;
  message?: { text?: string; markdown?: string };
  locations?: { physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number; endLine?: number; snippet?: { text?: string } } } }[];
  relatedLocations?: { physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number } } }[];
  attachments?: { artifactLocation?: { uri?: string } }[];
  properties?: { tags?: string[]; [k: string]: unknown };
  rank?: number;
  level?: string;
  workItemUris?: string[];
  [k: string]: unknown;
}

/**
 * The displayed body of a note. SARIF carries a message in two forms: `markdown`
 * (GitHub-Flavored, the formatted form) and `text` (the plain-text fallback that
 * must accompany it). Per SARIF 2.1.0 §3.11.9 only a consumer that *cannot*
 * render formatted text is required to fall back to `text` — Glassbox renders
 * markdown (`renderNoteMarkdown`), so it prefers `markdown` and a producer that
 * writes a spec-correct plain/rich pair keeps its formatting.
 */
function noteBody(r: NoteResult): string {
  return r.message?.markdown ?? r.message?.text ?? '';
}

/** Patch for `updateNote`. Anchor (file/lines) is immutable — that's a new note. */
export interface NotePatch {
  body?: string;
  kind?: NoteKind;
  confidence?: number;
  rank?: number;
  ticket?: string;
}

function writeLog(path: string, log: SarifLog): void {
  writeFileSync(path, JSON.stringify(log, null, 2) + '\n', 'utf-8');
}

const ARTIFACT_HASH_MAX_BYTES = 50_000_000;
const LFS_FILTER_LINE = '.pr-notes/artifacts/** filter=lfs diff=lfs merge=lfs -text';

/** sha-256 (hex) of each readable artifact, for verification provenance
 *  (docs/20 §20.5 P4c). Path-contained; skips missing / oversized files. */
function hashArtifacts(repoRoot: string, artifacts: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const uri of artifacts) {
    const safe = uri.replace(/\\/g, '/').replace(/^\/+/, '');
    if (/(^|\/)\.\.(\/|$)/.test(safe)) continue;
    try {
      const abs = join(repoRoot, safe);
      const stat = statSync(abs);
      if (!stat.isFile() || stat.size > ARTIFACT_HASH_MAX_BYTES) continue;
      out[uri] = createHash('sha256').update(readFileSync(abs)).digest('hex');
    } catch { /* unreadable — no hash */ }
  }
  return out;
}

/** Idempotently add the Git LFS filter for `.pr-notes/artifacts/` binaries. */
function ensureArtifactLfsFilter(repoRoot: string): void {
  const path = join(repoRoot, '.gitattributes');
  try {
    const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
    if (existing.includes('.pr-notes/artifacts/**')) return;
    const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
    writeFileSync(path, `${existing}${prefix}${LFS_FILTER_LINE}\n`, 'utf-8');
  } catch { /* best-effort */ }
}

/** Shard file paths for a source file, ascending. */
function listShardPaths(repoRoot: string, safeRel: string): string[] {
  return listShardIndices(repoRoot, safeRel).map(i => shardPath(repoRoot, safeRel, i));
}

/** Every notes shard under `.pr-notes/notes/` — used when the note's file isn't
 *  known (lookup by guid alone). */
function allShardPaths(repoRoot: string): string[] {
  const root = join(repoRoot, NOTES_SUBDIR);
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { recursive: true }) as string[];
  return entries.filter(e => SHARD_RE.test(e)).map(e => join(root, e));
}

/** Drop empty runs, then write the shard — or delete it if no results remain. */
function persistOrDelete(path: string, log: SarifLog): void {
  log.runs = log.runs.filter(run => run.results.length > 0);
  if (log.runs.length === 0) {
    if (existsSync(path)) unlinkSync(path);
  } else {
    writeLog(path, log);
  }
}

/** Remove a note by guid. Searches the file's shards if `file` is given, else
 *  every shard. Returns true if a note was removed. */
export function removeNote(repoRoot: string, guid: string, file?: string): boolean {
  const paths = file !== undefined ? listShardPaths(repoRoot, sanitizeRel(file)) : allShardPaths(repoRoot);
  for (const path of paths) {
    const log = readLog(path);
    for (const run of log.runs) {
      const idx = run.results.findIndex(r => (r as NoteResult).guid === guid);
      if (idx !== -1) {
        run.results.splice(idx, 1);
        persistOrDelete(path, log);
        return true;
      }
    }
  }
  return false;
}

/** Apply a patch to a note by guid (anchor is immutable). Returns true if found. */
export function updateNote(repoRoot: string, guid: string, patch: NotePatch, file?: string): boolean {
  const paths = file !== undefined ? listShardPaths(repoRoot, sanitizeRel(file)) : allShardPaths(repoRoot);
  for (const path of paths) {
    const log = readLog(path);
    for (const run of log.runs) {
      const result = run.results.find(r => (r as NoteResult).guid === guid) as NoteResult | undefined;
      if (result !== undefined) {
        if (patch.body !== undefined) result.message = noteMessage(patch.body);
        if (patch.kind !== undefined) {
          result.properties = { ...result.properties, tags: [patch.kind] };
          result.level = patch.kind === 'risk' ? 'warning' : 'none';
        }
        if (patch.confidence !== undefined) {
          result.properties = { ...result.properties, [CONFIDENCE_PROPERTY_KEY]: patch.confidence };
        }
        if (patch.rank !== undefined) result.rank = patch.rank;
        if (patch.ticket !== undefined) result.workItemUris = patch.ticket === '' ? undefined : [patch.ticket];
        writeLog(path, log);
        return true;
      }
    }
  }
  return false;
}

/** Identity key for dedup: same anchor + kind + body is a redundant note. */
function noteKey(r: NoteResult): string {
  const loc = r.locations?.[0]?.physicalLocation;
  return JSON.stringify([
    loc?.artifactLocation?.uri,
    loc?.region?.startLine,
    loc?.region?.endLine,
    r.properties?.tags,
    noteBody(r),
  ]);
}

/**
 * Mechanical coalescing pass for one file (docs/20 §20.4): drop redundant notes
 * — identical anchor + kind + body — keeping the most recent (last-written)
 * occurrence. Returns the number of notes removed. (Cross-cutting AI linking is
 * a separate, AI-driven concern — tracked as its own follow-up.)
 */
export function coalesceFile(repoRoot: string, file: string): number {
  const paths = listShardPaths(repoRoot, sanitizeRel(file));
  const logs = paths.map(path => ({ path, log: readLog(path) }));

  interface Ref { logIdx: number; runIdx: number; resultIdx: number; key: string }
  const refs: Ref[] = [];
  logs.forEach((entry, logIdx) => {
    entry.log.runs.forEach((run, runIdx) => {
      run.results.forEach((r, resultIdx) => {
        refs.push({ logIdx, runIdx, resultIdx, key: noteKey(r as NoteResult) });
      });
    });
  });

  const lastIndexForKey = new Map<string, number>();
  refs.forEach((ref, i) => lastIndexForKey.set(ref.key, i));
  const toRemove = refs.filter((ref, i) => lastIndexForKey.get(ref.key) !== i);
  if (toRemove.length === 0) return 0;

  // Splice descending within each (log, run) so indices stay valid.
  const touched = new Set<number>();
  const byRun = new Map<string, number[]>();
  for (const ref of toRemove) {
    const k = `${String(ref.logIdx)}:${String(ref.runIdx)}`;
    const arr = byRun.get(k) ?? [];
    arr.push(ref.resultIdx);
    byRun.set(k, arr);
    touched.add(ref.logIdx);
  }
  for (const [k, idxs] of byRun) {
    const [logIdx, runIdx] = k.split(':').map(Number);
    const results = logs[logIdx].log.runs[runIdx].results;
    for (const idx of idxs.sort((a, b) => b - a)) results.splice(idx, 1);
  }
  for (const logIdx of touched) persistOrDelete(logs[logIdx].path, logs[logIdx].log);
  return toRemove.length;
}

/** Forward-slash prefix of the on-disk notes tree (doc 20 §20.1). A literal —
 *  not `NOTES_SUBDIR`, whose separator is OS-specific — because it's matched
 *  against git diff paths, which are always forward-slashed. */
const NOTES_PATH_PREFIX = '.pr-notes/notes/';

/** Map a note shard's repo-relative path back to the source path it annotates,
 *  or null if it isn't a note shard. The inverse of the store layout
 *  (`.pr-notes/notes/<src>.NNNNNN.sarif` → `<src>`). Used to tell which files a
 *  review's *own* note changes concern (doc 20 §20.6, GB-1137) — i.e. the note
 *  shards that appear in the review's diff — rather than every file that has ever
 *  had a note on disk. */
export function noteSourceForShardPath(relPath: string): string | null {
  const norm = relPath.replace(/\\/g, '/');
  if (!norm.startsWith(NOTES_PATH_PREFIX) || !SHARD_RE.test(norm)) return null;
  return norm.slice(NOTES_PATH_PREFIX.length).replace(SHARD_RE, '');
}

/** The set of source paths whose note shard appears among `filePaths` — i.e. the
 *  files whose review notes belong to THIS review (doc 20 §20.6). A review's note
 *  shards are themselves among its changed files, so passing the review's file
 *  paths yields the sources with notes *in this review*. Used to scope the
 *  sidebar note icon (GB-1136) to the review's own note changes, not every file
 *  that has notes on disk. */
export function notedSourcesInFiles(filePaths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of filePaths) {
    const src = noteSourceForShardPath(p);
    if (src !== null) out.add(src);
  }
  return out;
}

/** Coalesce every file with notes. Returns the total number removed. */
export function coalesceAll(repoRoot: string): number {
  const root = join(repoRoot, NOTES_SUBDIR);
  if (!existsSync(root)) return 0;
  const sources = new Set<string>();
  for (const entry of readdirSync(root, { recursive: true }) as string[]) {
    const m = SHARD_RE.exec(entry);
    if (m !== null) sources.add(entry.replace(SHARD_RE, '').replace(/\\/g, '/'));
  }
  let total = 0;
  for (const src of sources) total += coalesceFile(repoRoot, src);
  return total;
}

// --- Reader (the consumer side of the format; GB-896 P2) -------------------

/**
 * Load the review notes for a single source file, flattened to diff-anchored
 * view items (docs/20 §20.6). Notes anchor to the **new** side of the diff (the
 * working-tree file the producer wrote them against). A shard that isn't a
 * SARIF log we recognize is skipped, not thrown — a corrupt note file must
 * never break the diff view.
 */
const ARTIFACT_MAX_BYTES = 20_000;

/** Read a text/diagram-source artifact's content for inline display (docs/20
 *  §20.5 P4). Returns undefined for a missing, oversized, binary, or
 *  path-escaping artifact — the renderer then shows a reference instead. */
function readArtifactText(repoRoot: string, uri: string): string | undefined {
  const safe = uri.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/(^|\/)\.\.(\/|$)/.test(safe)) return undefined; // never read outside the repo
  try {
    const abs = join(repoRoot, safe);
    const stat = statSync(abs);
    if (!stat.isFile() || stat.size > ARTIFACT_MAX_BYTES) return undefined;
    const buf = readFileSync(abs);
    if (buf.includes(0)) return undefined; // a NUL byte ⇒ treat as binary
    // In a clone without Git LFS an artifact file is the pointer text, not the
    // artifact (doc 20 §20.5 tracks binaries through LFS). Showing `oid
    // sha256:…` in place of the proof it stands for is worse than showing the
    // reference and letting the reader fetch it.
    if (isLfsPointer(buf)) return undefined;
    return buf.toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * `result.relatedLocations` → the flat targets an embedded link resolves
 * against (docs/20 §20.6). **Index-preserving**: a body's `[text](N)` names the
 * Nth entry, so an unusable entry becomes a placeholder rather than shifting
 * every later link onto the wrong target. The renderer drops placeholders back
 * to literal text.
 */
function readRelated(result: NoteResult): RelatedLocation[] | undefined {
  const raw = result.relatedLocations;
  if (raw === undefined || raw.length === 0) return undefined;
  return raw.map(entry => {
    const uri = entry.physicalLocation?.artifactLocation?.uri;
    const line = entry.physicalLocation?.region?.startLine;
    if (typeof uri !== 'string' || uri === '' || typeof line !== 'number') return { uri: '', line: 0 };
    return { uri, line };
  });
}

function readArtifacts(repoRoot: string, result: NoteResult): ReviewNoteArtifact[] | undefined {
  const out: ReviewNoteArtifact[] = [];
  for (const att of result.attachments ?? []) {
    const uri = att.artifactLocation?.uri;
    if (typeof uri !== 'string' || uri === '') continue;
    if (IMAGE_ARTIFACT_RE.test(uri)) {
      out.push({ uri, isImage: true }); // served as bytes, not read as text
    } else {
      out.push({ uri, content: readArtifactText(repoRoot, uri) });
    }
  }
  return out.length > 0 ? out : undefined;
}

export function loadReviewNotesForFile(repoRoot: string, file: string): ReviewNoteView[] {
  const safeRel = sanitizeRel(file);
  const out: ReviewNoteView[] = [];
  for (const path of listShardPaths(repoRoot, safeRel)) {
    let log: SarifLog;
    try {
      log = readLog(path);
    } catch {
      continue;
    }
    for (const run of log.runs) {
      const producer = run.tool.driver.name;
      for (const raw of run.results) {
        const r = raw as NoteResult;
        const region = r.locations?.[0]?.physicalLocation?.region;
        const startLine = region?.startLine;
        const kind = r.properties?.tags?.[0];
        if (startLine === undefined || kind === undefined || !isNoteKind(kind)) continue;
        const confidence = r.properties?.[CONFIDENCE_PROPERTY_KEY];
        out.push({
          guid: r.guid,
          line: startLine,
          side: 'new',
          kind,
          body: noteBody(r),
          confidence: typeof confidence === 'number' ? confidence : undefined,
          producer: producer === '' ? undefined : producer,
          snippet: region?.snippet?.text,
          related: readRelated(r),
          artifacts: readArtifacts(repoRoot, r),
        });
      }
    }
  }
  return out;
}
