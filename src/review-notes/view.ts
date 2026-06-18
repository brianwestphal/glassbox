/**
 * Client/server-shared view shape for rendering AI-authored review notes
 * (docs/20 §20.6, P2). The server reads `.pr-notes/` SARIF into these flat,
 * diff-anchored items and renders them review-comment-style in the diff. Pure
 * (no Node deps) so both the server reader and the `DiffView` component import
 * it.
 */
import type { NoteKind } from './types.js';

/** Short display label per note kind (the badge text). */
export const REVIEW_NOTE_LABELS: Record<string, string> = {
  rationale: 'Rationale',
  proof: 'Proof',
  assumption: 'Assumption',
  'alternative-considered': 'Alternative',
  risk: 'Risk',
  'test-evidence': 'Test',
};

/** One review note, flattened from SARIF and anchored to a diff line. */
export interface ReviewNoteView {
  /** The note's SARIF guid — the stable anchor a reviewer reply links to. */
  guid?: string;
  line: number;
  side: 'old' | 'new';
  kind: NoteKind;
  body: string;
  confidence?: number;
  producer?: string;
  /** The text the note was authored against, used to re-anchor it against the
   *  current tree (docs/20 §20.3 P3). */
  snippet?: string;
  /** Set by re-anchoring when the authored text can no longer be found at or
   *  near the note's line — the note is shown but flagged as possibly outdated. */
  stale?: boolean;
  /** Proof artifacts attached to the note (docs/20 §20.5). `content` is the
   *  text body when the artifact is text/diagram-source and readable; absent for
   *  binary, missing, or oversized artifacts (rendered as a reference instead). */
  artifacts?: ReviewNoteArtifact[];
}

export interface ReviewNoteArtifact {
  uri: string;
  /** Inline text content (text/diagram-source artifacts). */
  content?: string;
  /** True for image artifacts (`.png`/`.webp`/`.avif`/`.gif`/`.jpg`/`.svg`) —
   *  rendered via `<img>` served from `GET /api/review-notes/artifact`. */
  isImage?: boolean;
}

/** Image artifact extensions rendered inline as `<img>` (docs/20 §20.5 P4c). */
export const IMAGE_ARTIFACT_RE = /\.(png|webp|avif|gif|jpe?g|svg)$/i;
