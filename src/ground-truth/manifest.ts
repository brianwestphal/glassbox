import { readFileSync } from 'fs';
import { basename, dirname, isAbsolute, resolve } from 'path';
import { z } from 'zod';

import { isImageFile } from '../git/image-metadata.js';
import type { GroundTruthEntry } from '../git/types.js';

/**
 * The ground-truth comparison manifest (doc 26). A JSON file mapping each
 * **actual** image to its **expected** / ground-truth image. Paths resolve
 * relative to the manifest file's own directory (so a manifest is portable),
 * absolute paths are kept as-is, and either side may live outside the repo —
 * design specs usually aren't committed (doc 26 §26.2, doc 18 FR-18.9).
 *
 * - **`version: 1`** (P1): a single `comparisons` array of still-image pairs.
 * - **`version: 2`** (P3a, additive): keeps `comparisons` exactly as v1 and adds
 *   an optional **`sets`** array of ordered multi-step flows. A v2 manifest must
 *   declare at least one non-empty of `comparisons` / `sets`. Each **step** is a
 *   v1 comparison shape, so the per-pair resolver is reused unchanged; a set
 *   resolves to one synthetic image pair per step (keyed
 *   `set:<setIndex>/<stepIndex>-<actualBasename>`), carrying set grouping +
 *   order on each resolved entry. Steps inherit the set's `expectedKind` default
 *   (a step may override); a step's `label` is its own (basename fallback at
 *   render time) — the set `label` captions the group header, not the steps.
 */

/** One actual↔expected image pairing (a v1 comparison, or a v2 set step). */
export const GroundTruthComparisonSchema = z.object({
  /** Path to the actual image (the new / B side). */
  actual: z.string().min(1),
  /** Path to the expected / ground-truth image (the old / A side). */
  expected: z.string().min(1),
  /** Optional reviewer-facing label for the source list. */
  label: z.string().min(1).optional(),
  /** What the expected image represents (display hint only). */
  expectedKind: z.enum(['spec', 'reference', 'previous-actual']).optional(),
});

/** An ordered multi-step flow: an actual *set* compared against an expected
 *  *set* (doc 26 §26.3 FR-26.9). `version: 2` only. */
export const GroundTruthSetSchema = z.object({
  /** Group header caption (basename-of-first-step fallback at render time). */
  label: z.string().min(1).optional(),
  /** Default `expectedKind` inherited by every step that doesn't set its own. */
  expectedKind: z.enum(['spec', 'reference', 'previous-actual']).optional(),
  /** The ordered steps of the flow (at least one). */
  steps: z.array(GroundTruthComparisonSchema).min(1),
});

export const GroundTruthManifestV1Schema = z.object({
  version: z.literal(1),
  comparisons: z.array(GroundTruthComparisonSchema).min(1),
});

export const GroundTruthManifestV2Schema = z
  .object({
    version: z.literal(2),
    comparisons: z.array(GroundTruthComparisonSchema).optional(),
    sets: z.array(GroundTruthSetSchema).optional(),
  })
  .refine(m => (m.comparisons?.length ?? 0) + (m.sets?.length ?? 0) > 0, {
    message: 'a version 2 manifest must declare at least one comparison or set',
  });

export type GroundTruthManifest =
  | z.infer<typeof GroundTruthManifestV1Schema>
  | z.infer<typeof GroundTruthManifestV2Schema>;

/**
 * Read, validate, and resolve a ground-truth manifest into a flat list of review
 * entries (singles first, then each set's steps in order). Throws a descriptive
 * Error on missing file, bad JSON, unsupported version, schema violations, or a
 * non-image actual/expected (images only). Paths are resolved against the
 * manifest's directory; keys are deduplicated so two same-named actuals (or
 * steps) stay distinct in the source list.
 */
export function loadGroundTruthManifest(manifestPath: string): GroundTruthEntry[] {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch {
    throw new Error(`Cannot read ground-truth manifest: ${manifestPath}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Ground-truth manifest is not valid JSON: ${manifestPath}`);
  }

  // Read the version up front so an unsupported one gives a clean message rather
  // than an opaque union-mismatch error. `version` stays `unknown` (no cast).
  const head = z.object({ version: z.unknown() }).safeParse(json);
  const version = head.success ? head.data.version : undefined;
  if (version !== 1 && version !== 2) {
    throw new Error(
      `Ground-truth manifest has unsupported version ${JSON.stringify(version)} (supported: 1, 2): ${manifestPath}`,
    );
  }

  const schema = version === 1 ? GroundTruthManifestV1Schema : GroundTruthManifestV2Schema;
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Ground-truth manifest is invalid (${manifestPath}): ${detail}`);
  }

  const baseDir = dirname(resolve(manifestPath));
  const resolvePath = (p: string): string => (isAbsolute(p) ? p : resolve(baseDir, p));

  // Shared dedupe across singles + steps so every key in the review is distinct.
  const used = new Set<string>();
  const dedupe = (key: string): string => {
    if (used.has(key)) {
      let n = 2;
      while (used.has(`${key} (${n})`)) n++;
      key = `${key} (${n})`;
    }
    used.add(key);
    return key;
  };

  const assertImages = (c: z.infer<typeof GroundTruthComparisonSchema>, where: string): void => {
    for (const [role, p] of [['actual', c.actual], ['expected', c.expected]] as const) {
      if (!isImageFile(p)) {
        throw new Error(
          `Ground-truth manifest ${where}: ${role} "${p}" is not an image (images only).`,
        );
      }
    }
  };

  const entries: GroundTruthEntry[] = [];

  // Singles (v1 + v2 `comparisons`). Key off the actual path the user wrote (it
  // carries the image extension), as in P1.
  parsed.data.comparisons?.forEach((c, index) => {
    assertImages(c, `entry ${index + 1}`);
    entries.push({
      key: dedupe(c.actual.replace(/\\/g, '/')),
      actualPath: resolvePath(c.actual),
      expectedPath: resolvePath(c.expected),
      ...(c.label !== undefined ? { label: c.label } : {}),
      ...(c.expectedKind !== undefined ? { expectedKind: c.expectedKind } : {}),
    });
  });

  // Sets (v2 only). Each step becomes one synthetic pair keyed
  // `set:<setIndex>/<stepIndex>-<actualBasename>`, carrying the set grouping +
  // order. expectedKind inherits the set default; label stays per-step.
  ('sets' in parsed.data ? parsed.data.sets : undefined)?.forEach((set, setIndex) => {
    set.steps.forEach((step, stepIndex) => {
      assertImages(step, `set ${setIndex + 1} step ${stepIndex + 1}`);
      const expectedKind = step.expectedKind ?? set.expectedKind;
      entries.push({
        key: dedupe(`set:${setIndex}/${stepIndex}-${basename(step.actual.replace(/\\/g, '/'))}`),
        actualPath: resolvePath(step.actual),
        expectedPath: resolvePath(step.expected),
        ...(step.label !== undefined ? { label: step.label } : {}),
        ...(expectedKind !== undefined ? { expectedKind } : {}),
        setIndex,
        ...(set.label !== undefined ? { setLabel: set.label } : {}),
        stepIndex,
        stepCount: set.steps.length,
      });
    });
  });

  return entries;
}
