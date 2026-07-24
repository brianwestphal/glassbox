/**
 * AI-Authored Review Notes (docs/20) — P1 shared types.
 *
 * A review note is a line-anchored explanation a *producer* (Claude Code, Hot
 * Sheet, any AI tool) emits as it writes code. Glassbox is the *consumer*: it
 * reads the tool-neutral SARIF 2.1.0 files under `.pr-notes/`. This file is the
 * format contract shared by the writer (the `glassbox note` CLI) and, later,
 * the reader.
 */

/** Controlled vocabulary for the kind of a note (docs/20 §20.2). Stored as a
 *  SARIF `result.properties.tags` entry — the idiomatic SARIF categorization
 *  slot, not a bespoke field. */
export const NOTE_KINDS = [
  'rationale',
  'proof',
  'assumption',
  'alternative-considered',
  'risk',
  'test-evidence',
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export function isNoteKind(value: string): value is NoteKind {
  return (NOTE_KINDS as readonly string[]).includes(value);
}

/** A single note as supplied by a producer (before SARIF mapping). */
export interface ReviewNoteInput {
  /** Repo-relative source file path the note anchors to. */
  file: string;
  startLine: number;
  endLine: number;
  /** Markdown body. */
  body: string;
  kind: NoteKind;
  /** 0–1. The one datum with no standard SARIF home → stored under the
   *  namespaced custom property `ext-ai-tool-confidence`. */
  confidence?: number;
  /** 0–100 importance → SARIF `result.rank`. */
  rank?: number;
  /** Linked ticket id or URL → SARIF `result.workItemUris`. */
  ticket?: string;
  /** Producer identity → SARIF `run.tool.driver.name` / `.version`. */
  producer?: string;
  producerVersion?: string;
  /** Repo-relative paths to committed proof artifacts (test output, logs,
   *  diagram source) → SARIF `result.attachments[].artifactLocation.uri`
   *  (docs/20 §20.5). */
  artifacts?: string[];
  /** Other code locations the body links to → SARIF `result.relatedLocations`.
   *  A body references one by its index: `[the caller](0)` — SARIF's "embedded
   *  link" syntax (§3.11.6), rendered as a jump-to-line link (docs/20 §20.6). */
  related?: RelatedLocation[];
}

/** One entry of `result.relatedLocations`: a repo-relative file and 1-based line. */
export interface RelatedLocation {
  uri: string;
  line: number;
}

/** Property-bag key for the one non-standard datum. Namespaced (`ext-`,
 *  "AI tool") so it's clearly a producer extension, not a SARIF or Glassbox
 *  field. */
export const CONFIDENCE_PROPERTY_KEY = 'ext-ai-tool-confidence';

/** `partialFingerprints` algorithm key — names the format's anchor-hash scheme,
 *  not any specific tool. */
export const ANCHOR_FINGERPRINT_KEY = 'prNoteAnchor/v1';

/** Default producer name when a writer doesn't identify itself. */
export const DEFAULT_PRODUCER = 'unknown-ai-tool';

/** Max SARIF results per shard file before rolling to the next index — caps the
 *  size of any single notes file for hot, frequently-edited source files
 *  (docs/20 §20.1 layout). */
export const DEFAULT_SHARD_CAP = 10000;
