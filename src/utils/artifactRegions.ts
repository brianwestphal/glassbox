import { type ImageRegion, ImageRegionSchema } from '../db/schemas.js';

/**
 * Helpers for the marked regions a reviewer draws on an AI review note's image
 * artifact and carries into a reply (doc 25 §25 / GB-953, GB-959).
 *
 * A reply's `region_data` column holds either a single region object (the
 * original GB-953 shape, still produced by any old row) or a JSON **array** of
 * regions (GB-959: several marks on one reply). Both decode through here. Only
 * regions that name an `artifact` belong to a note reply; ordinary image-diff
 * regions (doc 23) have no artifact and are ignored.
 */

/** Decode an annotation's `region_data` into the artifact-anchored regions it
 *  carries. Accepts a single region object or an array; tolerates null / empty /
 *  malformed input and drops any entry without an `artifact`. */
export function parseArtifactRegions(regionData: string | null | undefined): ImageRegion[] {
  if (regionData === null || regionData === undefined || regionData === '') return [];
  let raw: unknown;
  try {
    raw = JSON.parse(regionData);
  } catch {
    return [];
  }
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  const out: ImageRegion[] = [];
  for (const item of items) {
    const parsed = ImageRegionSchema.safeParse(item);
    if (parsed.success && parsed.data.artifact !== undefined) out.push(parsed.data);
  }
  return out;
}

/** Group artifact regions by their artifact uri, preserving first-seen order, so
 *  a reply renders one thumbnail per artifact with every mark overlaid on it. */
export function groupRegionsByArtifact(regions: ImageRegion[]): { artifact: string; regions: ImageRegion[] }[] {
  const order: string[] = [];
  const byArtifact = new Map<string, ImageRegion[]>();
  for (const r of regions) {
    const artifact = r.artifact;
    if (artifact === undefined) continue;
    let list = byArtifact.get(artifact);
    if (list === undefined) {
      list = [];
      byArtifact.set(artifact, list);
      order.push(artifact);
    }
    list.push(r);
  }
  return order.map(artifact => ({ artifact, regions: byArtifact.get(artifact) ?? [] }));
}
