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
}
