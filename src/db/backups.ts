import { readdirSync, rmSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';

/** A retained pre-upgrade copy of the review database. */
export interface DatabaseBackup {
  /** Directory name, e.g. `reviews.bak-2026-08-03T04-04-05-853Z`. */
  name: string;
  /** Absolute path, so the UI can show the user exactly what it would remove. */
  path: string;
  /** Total size on disk in bytes. */
  bytes: number;
  /** When the backup was taken, from the name's timestamp; null if unparseable. */
  createdAt: string | null;
}

/**
 * The prefix `backupDataDir` writes. Deliberately narrow: it must not match the
 * `reviews.unreadable-<ts>` directories the corrupt-database recovery leaves
 * behind (doc 9 §9.5). Those look similar and are equally permanent, but they
 * are not equivalent — an unreadable directory can be the user's *only* copy of
 * data that never migrated, so offering a one-click delete for it would be a
 * different and much riskier feature.
 */
const BACKUP_PREFIX = '.bak-';

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
  const parent = dirname(dbPath);
  const prefix = `${basename(dbPath)}${BACKUP_PREFIX}`;

  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }

  return entries
    .filter((name) => name.startsWith(prefix))
    .map((name) => {
      const path = join(parent, name);
      return {
        name,
        path,
        bytes: directorySize(path),
        createdAt: parseStamp(name.slice(prefix.length)),
      };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
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
