import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

import { loadGroundTruthManifest } from './manifest.js';

/**
 * `glassbox ground-truth promote <manifest>` (doc 26 §26.6 FR-26.15 P3d).
 *
 * An **optional** convenience for previous-actual regression over a flow: copies
 * the current run's **actual** images over the **baseline** they are compared
 * against, so the *next* run's `expected` (pointing at the same baseline path)
 * regresses against this run. Glassbox still owns **no** baseline state — promote
 * is an explicit, user-invoked file copy, nothing more.
 *
 * **Safety by construction.** Only entries whose `expectedKind` is
 * `previous-actual` are promoted. Those entries declare a baseline as their
 * `expected`; spec / reference expecteds (design specs, reference renders) are
 * **never** overwritten, so a stray `promote` can't clobber a committed spec. An
 * entry whose actual doesn't exist is skipped (reported), never silently passed.
 */

export interface PromoteResult {
  /** Baselines written (resolved absolute paths). */
  promoted: { key: string; from: string; to: string }[];
  /** Entries left untouched, with why. */
  skipped: { key: string; reason: string }[];
}

export function promoteGroundTruthBaselines(manifestPath: string): PromoteResult {
  // Reuse the loader so paths resolve exactly as a review would see them.
  const entries = loadGroundTruthManifest(manifestPath);

  const result: PromoteResult = { promoted: [], skipped: [] };
  for (const entry of entries) {
    if (entry.expectedKind !== 'previous-actual') {
      result.skipped.push({
        key: entry.key,
        reason: `expectedKind is ${entry.expectedKind ?? 'unset'}, not previous-actual (only baselines are promoted)`,
      });
      continue;
    }
    if (!existsSync(entry.actualPath)) {
      result.skipped.push({ key: entry.key, reason: `actual image not found: ${entry.actualPath}` });
      continue;
    }
    mkdirSync(dirname(entry.expectedPath), { recursive: true });
    copyFileSync(entry.actualPath, entry.expectedPath);
    result.promoted.push({ key: entry.key, from: entry.actualPath, to: entry.expectedPath });
  }
  return result;
}
