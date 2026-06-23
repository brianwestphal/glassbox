import { readFileSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { z } from 'zod';

import { isImageFile } from '../git/image-metadata.js';
import type { GroundTruthEntry } from '../git/types.js';

/**
 * The ground-truth comparison manifest (doc 26 P1). A JSON file mapping each
 * **actual** image to its **expected** / ground-truth image. Paths resolve
 * relative to the manifest file's own directory (so a manifest is portable),
 * absolute paths are kept as-is, and either side may live outside the repo —
 * design specs usually aren't committed (doc 26 §26.2, doc 18 FR-18.9).
 *
 * v1 is single still images only; the set/flow shape (doc 26 §26.3) is P3.
 */

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

export const GroundTruthManifestSchema = z.object({
  version: z.literal(1),
  comparisons: z.array(GroundTruthComparisonSchema).min(1),
});
export type GroundTruthManifest = z.infer<typeof GroundTruthManifestSchema>;

/**
 * Read, validate, and resolve a ground-truth manifest into review entries.
 * Throws a descriptive Error on missing file, bad JSON, schema violations, or a
 * non-image actual/expected (P1 is images only). Paths are resolved against the
 * manifest's directory; keys are deduplicated so two same-named actuals stay
 * distinct in the source list.
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

  const parsed = GroundTruthManifestSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Ground-truth manifest is invalid (${manifestPath}): ${detail}`);
  }

  const baseDir = dirname(resolve(manifestPath));
  const resolvePath = (p: string): string => (isAbsolute(p) ? p : resolve(baseDir, p));

  const used = new Set<string>();
  return parsed.data.comparisons.map((c, index) => {
    for (const [role, p] of [['actual', c.actual], ['expected', c.expected]] as const) {
      if (!isImageFile(p)) {
        throw new Error(
          `Ground-truth manifest entry ${index + 1}: ${role} "${p}" is not an image (P1 supports images only).`,
        );
      }
    }

    // Key off the actual path the user wrote (it carries the image extension);
    // dedupe so duplicate names stay distinct in the source list.
    let key = c.actual.replace(/\\/g, '/');
    if (used.has(key)) {
      let n = 2;
      while (used.has(`${key} (${n})`)) n++;
      key = `${key} (${n})`;
    }
    used.add(key);

    return {
      key,
      actualPath: resolvePath(c.actual),
      expectedPath: resolvePath(c.expected),
      ...(c.label !== undefined ? { label: c.label } : {}),
      ...(c.expectedKind !== undefined ? { expectedKind: c.expectedKind } : {}),
    };
  });
}
