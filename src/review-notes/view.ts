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
  line: number;
  side: 'old' | 'new';
  kind: NoteKind;
  body: string;
  confidence?: number;
  producer?: string;
}
