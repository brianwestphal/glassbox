import type { GroundTruthMeta } from '../api/files.js';
import type { GroundTruthEntry, ReviewMode } from '../git/types.js';

/**
 * Ground-truth comparison presentation helpers (doc 26 §26.1). Pure, so they
 * are shared by the file-list route and the server-rendered diff page without
 * any I/O — the resolved manifest already rides in the review mode.
 */

/** Human-facing names for what an expected image represents. */
export const EXPECTED_KIND_LABELS: Record<NonNullable<GroundTruthMeta['expectedKind']>, string> = {
  spec: 'Spec',
  reference: 'Reference',
  'previous-actual': 'Baseline',
};

/**
 * Side labels for the image comparison panes. In ground-truth mode the expected
 * image is the old/A side and the actual is the new/B side, so they read
 * "Expected (A)" / "Actual (B)" instead of the generic "Old (A)" / "New (B)".
 * Returns `undefined` for every other mode (callers fall back to the defaults).
 */
export function groundTruthSideLabels(mode: ReviewMode): { old: string; new: string } | undefined {
  if (mode.type !== 'ground-truth') return undefined;
  return { old: 'Expected (A)', new: 'Actual (B)' };
}

/** The matching manifest entry's display metadata for one comparison key. */
function metaFromEntry(entry: GroundTruthEntry): GroundTruthMeta {
  return {
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    ...(entry.expectedKind !== undefined ? { expectedKind: entry.expectedKind } : {}),
  };
}

/**
 * Build a `fileId → GroundTruthMeta` map for a ground-truth review. Every file
 * whose path matches a manifest key gets an entry (possibly empty), so the
 * map's presence also tells the client the review is ground-truth. Returns
 * `undefined` for non-ground-truth reviews.
 */
export function groundTruthMetaByFileId(
  mode: ReviewMode,
  files: { id: string; file_path: string }[],
): Record<string, GroundTruthMeta> | undefined {
  if (mode.type !== 'ground-truth') return undefined;
  const byKey = new Map(mode.comparisons.map(c => [c.key, c]));
  const out: Record<string, GroundTruthMeta> = {};
  for (const file of files) {
    const entry = byKey.get(file.file_path);
    if (entry) out[file.id] = metaFromEntry(entry);
  }
  return out;
}
