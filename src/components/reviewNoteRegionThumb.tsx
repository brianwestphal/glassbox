import type { SafeHtml } from 'kerfjs';

import { groupRegionsByArtifact, parseArtifactRegions } from '../utils/artifactRegions.js';

/**
 * When an annotation (a note reply) carries one or more regions drawn on an AI
 * review note's image artifact (doc 25 / GB-953, GB-959), render each artifact
 * with its marked rectangle(s) over it — the "see this spot" thumbnail that
 * rides along in the reply. Returns null for annotations without an
 * artifact-scoped region.
 *
 * Shared by the server-rendered reply (`diffView.tsx`) and the client-rendered
 * new reply (`annotations/render.tsx`); the geometry is plain percentages so it
 * needs no client-only code. A reply may carry several regions (one or more per
 * artifact); they are grouped so each artifact renders once with every box.
 */
export function ReviewNoteRegionThumb({ regionData }: { regionData: string | null | undefined }): SafeHtml | null {
  const groups = groupRegionsByArtifact(parseArtifactRegions(regionData));
  if (groups.length === 0) return null;
  return (
    <div className="ai-note-reply-region">
      {groups.map(g => (
        <div className="ai-note-reply-region-frame">
          <img className="ai-note-reply-region-img" loading="lazy" alt={g.artifact}
            src={`/api/review-notes/artifact?file=${encodeURIComponent(g.artifact)}`} />
          {g.regions.map(r => (
            <div className="ai-note-reply-region-box"
              style={`left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`}></div>
          ))}
        </div>
      ))}
    </div>
  );
}
