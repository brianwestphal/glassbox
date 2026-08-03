import { readdirSync, rmSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';

/** A retained copy of the review database that Glassbox set aside. */
export interface DatabaseBackup {
  /** Directory name, e.g. `reviews.bak-2026-08-03T04-04-05-853Z`. */
  name: string;
  /** Absolute path, so the UI can show the user exactly what it refers to. */
  path: string;
  /** Total size on disk in bytes. */
  bytes: number;
  /** When it was set aside, from the name's timestamp; null if unparseable. */
  createdAt: string | null;
}

/**
 * The prefix `backupDataDir` writes for a verified pre-upgrade copy (§9.1a).
 *
 * Deliberately distinct from {@link QUARANTINE_PREFIX}: a backup is redundant by
 * construction — the migration validated that every row reached the live cluster
 * — so deleting it loses nothing.
 */
const BACKUP_PREFIX = '.bak-';

/**
 * The prefix `quarantineDataDir` writes when a cluster cannot be opened (§9.5).
 *
 * The opposite of a backup: this is data Glassbox *failed* to read, so it may be
 * the user's only copy. It is listed so the user can find it, but it is never
 * offered for deletion — {@link deleteDatabaseBackup} refuses it.
 */
const QUARANTINE_PREFIX = '.unreadable-';

/**
 * List the retained pre-upgrade database backups (doc 9 §9.1a).
 *
 * The major-version upgrade keeps a verified copy of the old cluster next to
 * the live one and never removes it, so this is what lets the user see that the
 * copy exists and reclaim the space once they trust the upgrade.
 *
 * @param dbPath - The canonical data directory (`<dataDir>/data/reviews`).
 * @returns Backups newest first; empty when there are none, including when the
 * containing directory does not exist.
 */
export function listDatabaseBackups(dbPath: string): DatabaseBackup[] {
  return listWithPrefix(dbPath, BACKUP_PREFIX);
}

/**
 * List the quarantined directories the corrupt-database recovery set aside
 * (doc 9 §9.5).
 *
 * Separate from {@link listDatabaseBackups} rather than a flag on it, because
 * the two are not interchangeable and the UI must not present them with the
 * same affordance: a backup is safe to delete, whereas this is data Glassbox
 * could not read and may be the user's only copy.
 */
export function listQuarantinedDirectories(dbPath: string): DatabaseBackup[] {
  return listWithPrefix(dbPath, QUARANTINE_PREFIX);
}

/**
 * Resolve a set-aside directory's absolute path by name, for read-only uses
 * such as revealing it in the OS file manager.
 *
 * Accepts either prefix — showing the user where something is carries none of
 * the risk of removing it — but applies the same traversal rules as
 * {@link deleteDatabaseBackup}, so it can never be aimed at the live cluster or
 * anywhere outside the data directory.
 *
 * @returns The absolute path, or null when the name does not identify one.
 */
export function resolvePreservedDirectory(dbPath: string, name: string): string | null {
  if (!isPreservedName(dbPath, name)) return null;
  const target = join(dirname(dbPath), name);
  try {
    return statSync(target).isDirectory() ? target : null;
  } catch {
    return null;
  }
}

/** Scan the data directory for siblings of the cluster carrying `prefix`. */
function listWithPrefix(dbPath: string, prefix: string): DatabaseBackup[] {
  const parent = dirname(dbPath);
  const full = `${basename(dbPath)}${prefix}`;

  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.startsWith(full))
    .map((name) => {
      const path = join(parent, name);
      return {
        name,
        path,
        bytes: directorySize(path),
        createdAt: parseStamp(name.slice(full.length)),
      };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

/**
 * Whether `name` identifies a set-aside sibling of the cluster.
 *
 * Requiring the name to be exactly its own basename is what rejects traversal:
 * `basename` alone would still accept `reviews.bak-a/../../escape`, which
 * `join` resolves outside the data directory entirely.
 */
function isPreservedName(dbPath: string, name: string): boolean {
  if (name !== basename(name)) return false;
  const stem = basename(dbPath);
  return name.startsWith(`${stem}${BACKUP_PREFIX}`) || name.startsWith(`${stem}${QUARANTINE_PREFIX}`);
}

/**
 * Delete one retained backup by name.
 *
 * Takes a name rather than a path, and re-derives the location from `dbPath`,
 * so a caller cannot direct this at an arbitrary directory: the name is
 * validated against the same prefix {@link listDatabaseBackups} produces, and
 * anything containing a path separator is refused outright.
 *
 * @returns Whether a backup was removed. False means the name did not match a
 * backup — never that a deletion silently failed.
 */
export function deleteDatabaseBackup(dbPath: string, name: string): boolean {
  const prefix = `${basename(dbPath)}${BACKUP_PREFIX}`;
  if (!name.startsWith(prefix)) return false;
  // `basename` alone would still accept `foo/../bar`; requiring the name to be
  // exactly its own basename rejects every traversal attempt.
  if (name !== basename(name)) return false;

  const target = join(dirname(dbPath), name);
  try {
    if (!statSync(target).isDirectory()) return false;
    rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Recursive size on disk, best-effort — an unreadable entry counts as zero. */
function directorySize(path: string): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = join(path, entry);
    try {
      const stat = statSync(child);
      total += stat.isDirectory() ? directorySize(child) : stat.size;
    } catch {
      // Skip anything that vanished or can't be read; a slightly low total is
      // better than failing to report the backup at all.
    }
  }
  return total;
}

/**
 * Recover an ISO timestamp from the directory suffix.
 *
 * `backupDataDir` builds the suffix by replacing `:` and `.` with `-`, which is
 * not reversible by a plain swap — the date's own hyphens are indistinguishable
 * from the substituted ones. Matching the fixed shape instead is what makes it
 * unambiguous.
 */
function parseStamp(suffix: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(suffix);
  if (m === null) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
