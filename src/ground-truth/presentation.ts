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
    ...(entry.setIndex !== undefined ? { setIndex: entry.setIndex } : {}),
    ...(entry.setLabel !== undefined ? { setLabel: entry.setLabel } : {}),
    ...(entry.stepIndex !== undefined ? { stepIndex: entry.stepIndex } : {}),
    ...(entry.stepCount !== undefined ? { stepCount: entry.stepCount } : {}),
  };
}

/**
 * Per-step navigator data for the diff header (doc 26 §26.3 FR-26.12). For a
 * file that is a step of a `version: 2` manifest set, returns the step's label,
 * its 1-based position + total, and the prev/next sibling step's review-file id
 * (bounded to the set). Returns `undefined` for singles and non-ground-truth
 * reviews — the header then shows no step control.
 */
export interface GroundTruthStepNav {
  setLabel: string;
  /** 0-based step index within the set. */
  stepIndex: number;
  /** Total steps in the set. */
  stepCount: number;
  label: string;
  prevFileId: string | null;
  nextFileId: string | null;
}

export function groundTruthStepNav(
  mode: ReviewMode,
  fileId: string,
  files: { id: string; file_path: string }[],
): GroundTruthStepNav | undefined {
  if (mode.type !== 'ground-truth') return undefined;

  const file = files.find(f => f.id === fileId);
  if (!file) return undefined;
  const entry = mode.comparisons.find(c => c.key === file.file_path);
  if (!entry || entry.setIndex === undefined) return undefined;

  // The set's steps, in order, mapped to their review-file ids.
  const fileIdByKey = new Map<string, string>();
  for (const f of files) fileIdByKey.set(f.file_path, f.id);
  const steps = mode.comparisons
    .filter(c => c.setIndex === entry.setIndex)
    .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
  const pos = steps.findIndex(c => c.key === entry.key);
  if (pos === -1) return undefined;

  const stepFileId = (i: number): string | null =>
    i >= 0 && i < steps.length ? fileIdByKey.get(steps[i].key) ?? null : null;

  return {
    setLabel: entry.setLabel ?? '',
    stepIndex: entry.stepIndex ?? pos,
    stepCount: entry.stepCount ?? steps.length,
    label: entry.label ?? (entry.key.split('/').pop() ?? entry.key),
    prevFileId: stepFileId(pos - 1),
    nextFileId: stepFileId(pos + 1),
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
