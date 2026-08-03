import { PGlite } from '@electric-sql/pglite';
import { existsSync, rmSync } from 'fs';
import {
  backupDataDir,
  introspectSchema,
  migrate,
  openDataDir,
  readClusterVersion,
  swapIntoPlace,
  validateMigration,
} from 'pglite-migrate';
import { acquireEngine } from 'pglite-migrate/engines';

/**
 * Outcome of a major-version migration attempt.
 *
 * `not-needed` covers both "nothing on disk" and "the directory is already at
 * the running engine's major". `blocked` means the directory really is from a
 * different Postgres major but we could not migrate it — the caller must not
 * treat that as corruption, because the data is intact and a later launch can
 * still migrate it.
 */
export type MajorMigrationResult =
  | { status: 'not-needed' }
  | { status: 'migrated'; fromMajor: number; toMajor: number; rows: number; backupPath: string }
  | { status: 'blocked'; fromMajor: number; reason: string };

/** Creates the application schema on a freshly made target cluster. */
type InitSchema = (db: PGlite) => Promise<void>;

/**
 * Migrate a data directory written by an older PostgreSQL major into one the
 * running PGlite engine can open.
 *
 * PGlite embeds a fixed Postgres major and ships no `pg_upgrade`, so a directory
 * written by an older engine cannot be opened at all — the failure is total, not
 * partial. `pglite-migrate` bridges it by running both engines side by side and
 * copying the rows across; the old engine is downloaded on demand rather than
 * shipped, since it is dead weight for every user who does not need it.
 *
 * Nothing destructive happens until the new cluster has been built *and*
 * validated: the migration writes to a staged sibling directory, and the
 * canonical path is only touched by the final atomic swap. Every failure path
 * therefore leaves the original directory exactly as it was, which is what makes
 * a `blocked` result safe to retry on a later launch.
 *
 * @param dbPath - The canonical data directory.
 * @param initSchema - Creates the app's schema on the new cluster. Passed in
 * rather than imported to keep this module free of a cycle back to the
 * connection module.
 * @returns What happened; never throws for an expected failure.
 */
export async function migrateMajorIfNeeded(
  dbPath: string,
  initSchema: InitSchema,
): Promise<MajorMigrationResult> {
  if (!existsSync(dbPath)) return { status: 'not-needed' };

  let fromMajor: number;
  try {
    fromMajor = await readClusterVersion(dbPath);
  } catch {
    // No readable PG_VERSION means this is not a recognizable cluster at all.
    // That is corruption, not a version gap, so leave it to the caller.
    return { status: 'not-needed' };
  }

  const staged = `${dbPath}.migrating-${timestamp()}`;
  let toMajor: number;
  try {
    toMajor = await buildTarget(staged, initSchema);
  } catch (err) {
    discard(staged);
    return { status: 'blocked', fromMajor, reason: describe(err) };
  }

  if (fromMajor === toMajor) {
    // Same major, so the open failure that brought us here was not a version
    // problem. Nothing to migrate; let the caller's recovery path handle it.
    discard(staged);
    return { status: 'not-needed' };
  }

  try {
    const { rows, backupPath } = await runMigration(dbPath, staged, fromMajor);
    return { status: 'migrated', fromMajor, toMajor, rows, backupPath };
  } catch (err) {
    discard(staged);
    return { status: 'blocked', fromMajor, reason: describe(err) };
  }
}

/**
 * Create the staged cluster with the app's own schema and report its major.
 *
 * Building the target is also how the running engine's major is discovered:
 * a fresh directory is stamped with it, so no separate probe (and no extra
 * engine boot) is needed to tell whether a migration is warranted at all.
 */
async function buildTarget(staged: string, initSchema: InitSchema): Promise<number> {
  const target = new PGlite(staged, DB_OPTIONS);
  try {
    await target.waitReady;
    await initSchema(target);
  } finally {
    await target.close();
  }
  return readClusterVersion(staged);
}

/**
 * Back up, transfer, validate, and swap. Split out so the caller's catch can
 * treat every failure in here identically: the canonical directory is untouched
 * until {@link swapIntoPlace}, which runs only after validation passes.
 */
async function runMigration(
  dbPath: string,
  staged: string,
  fromMajor: number,
): Promise<{ rows: number; backupPath: string }> {
  // `ephemeral` so the ~25 MB old engine is removed once the one-time migration
  // is done; keeping it cached would outlive its only use.
  const engine = await acquireEngine(fromMajor, { cache: 'ephemeral' });
  try {
    // Taken before the old engine opens the directory. That ordering is the
    // point: starting a cluster can write to it (WAL replay, recovery), so this
    // is the only copy guaranteed to be exactly what the user had. It also
    // makes the swap's own `.old-<ts>` copy redundant — see `keepOld` below.
    const backupPath = await backupDataDir(dbPath, { keep: 1 });

    // The old engine must be named explicitly: `openDataDir` prefers an
    // installed engine, and the one installed here is the *new* major that
    // cannot read this directory.
    const source = await openDataDir(dbPath, engine.entry, { pgliteOptions: DB_OPTIONS });
    // The staged cluster already carries the schema from `buildTarget`; this
    // only reopens it.
    const target = new PGlite(staged, DB_OPTIONS);
    try {
      await target.waitReady;

      const report = await migrate({ source, target });
      const schema = await introspectSchema(source);
      const validation = await validateMigration(source, target, schema, 'full');
      if (!validation.ok) {
        throw new Error(`post-migration validation failed: ${summarize(validation)}`);
      }
      const rows = report.tables.reduce((n, t) => n + t.rowsCopied, 0);

      // Both clusters must be closed before the swap: the directories are being
      // renamed out from under whatever still holds them open.
      await source.close();
      await target.close();
      // `keepOld: false` because the pre-open backup above already preserves the
      // original, and it is the better copy of the two. Retaining both would
      // leave two full-size duplicates of the database on disk after every
      // upgrade. The displaced directory is only removed once the new cluster is
      // successfully in place.
      await swapIntoPlace(dbPath, staged, { keepOld: false });
      return { rows, backupPath };
    } catch (err) {
      await source.close().catch(() => undefined);
      await target.close().catch(() => undefined);
      throw err;
    }
  } finally {
    await engine.cleanup().catch(() => undefined);
  }
}

/**
 * PGLite ≤0.3.x kept the working tables in `template1`; 0.4.0 changed the
 * default to `postgres`. Both sides of the migration must therefore pin
 * `template1` explicitly — the source because that is where the rows are, and
 * the target so the migrated cluster stays readable by the same connection
 * options the app uses everywhere else.
 */
const DB_OPTIONS = { database: 'template1' } as const;

/** Name the tables and sequences that failed validation, for the log line. */
function summarize(validation: { tables: { table: string; ok: boolean }[] }): string {
  const failed = validation.tables.filter((t) => !t.ok).map((t) => t.table);
  return failed.length > 0 ? failed.join(', ') : 'sequence check';
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Remove a staged directory, ignoring a failure — it is not the canonical one. */
function discard(staged: string): void {
  try {
    rmSync(staged, { recursive: true, force: true });
  } catch {
    // A leftover staged directory is inert: it carries a unique timestamp, so
    // it can never be mistaken for the canonical path or block a later attempt.
  }
}
