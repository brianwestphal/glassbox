import type { SafeHtml } from 'kerfjs';

import { ImageRegionSchema } from '../db/schemas.js';

/**
 * When an annotation (a note reply) carries a region drawn on an AI review
 * note's image artifact (doc 25 / GB-953), render the artifact image with the
 * marked rectangle over it — the "see this spot" thumbnail that rides along in
 * the reply. Returns null for annotations without an artifact-scoped region.
 *
 * Shared by the server-rendered reply (`diffView.tsx`) and the client-rendered
 * new reply (`annotations/render.tsx`); the geometry is plain percentages so it
 * needs no client-only code.
 */
export function ReviewNoteRegionThumb({ regionData }: { regionData: string | null | undefined }): SafeHtml | null {
  if (regionData === null || regionData === undefined || regionData === '') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(regionData);
  } catch {
    return null;
  }
  const parsed = ImageRegionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const artifact = r.artifact;
  if (artifact === undefined) return null;
  const box = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
  return (
    <div className="ai-note-reply-region">
      <div className="ai-note-reply-region-frame">
        <img className="ai-note-reply-region-img" loading="lazy" alt={artifact}
          src={`/api/review-notes/artifact?file=${encodeURIComponent(artifact)}`} />
        <div className="ai-note-reply-region-box" style={box}></div>
      </div>
    </div>
  );
}
