/**
 * SARIF 2.1.0 mapping for review notes (docs/20 §20.2). Maps one note to one
 * SARIF `result`, using standard SARIF fields wherever they exist and exactly
 * one namespaced custom property (`ext-ai-tool-confidence`). The on-disk file is
 * a valid SARIF log so any SARIF tool can parse it (NFR-20.9).
 */
import { z } from 'zod';

import { flattenMarkdown } from '../utils/flattenMarkdown.js';
import type { ReviewNoteInput } from './types.js';
import { ANCHOR_FINGERPRINT_KEY, CONFIDENCE_PROPERTY_KEY } from './types.js';

const SARIF_SCHEMA_URL = 'https://json.schemastore.org/sarif-2.1.0.json';
const REVIEW_NOTE_RULE_ID = 'review-note';

/** Minimal structural shape we read back when appending to an existing shard.
 *  Loose so unknown fields any producer wrote are preserved on round-trip (we
 *  mutate the parsed object rather than re-serializing from a stripped type). */
export const SarifLogShapeSchema = z.object({
  version: z.string(),
  runs: z.array(z.object({
    tool: z.object({ driver: z.object({ name: z.string() }).loose() }).loose(),
    versionControlProvenance: z.array(z.object({ revisionId: z.string().optional() }).loose()).optional(),
    results: z.array(z.unknown()),
  }).loose()),
}).loose();

export interface SarifRun {
  tool: { driver: { name: string; version?: string; informationUri?: string; rules?: unknown[] } };
  versionControlProvenance?: Array<{ repositoryUri?: string; revisionId?: string; branch?: string }>;
  results: unknown[];
  [k: string]: unknown;
}

export interface SarifLog {
  $schema?: string;
  version: string;
  runs: SarifRun[];
  [k: string]: unknown;
}

/** A fresh, empty SARIF log with a single run for the given producer + baseline
 *  commit. */
export function emptyLog(producer: string, opts: {
  producerVersion?: string;
  revisionId?: string;
  branch?: string;
  repositoryUri?: string;
} = {}): SarifLog {
  return { $schema: SARIF_SCHEMA_URL, version: '2.1.0', runs: [newRun(producer, opts)] };
}

/** Build a fresh run object for a (producer, baseline-commit) pair. */
export function newRun(producer: string, opts: {
  producerVersion?: string;
  revisionId?: string;
  branch?: string;
  repositoryUri?: string;
} = {}): SarifRun {
  const run: SarifRun = {
    tool: {
      driver: {
        name: producer,
        ...(opts.producerVersion !== undefined ? { version: opts.producerVersion } : {}),
        rules: [{
          id: REVIEW_NOTE_RULE_ID,
          name: 'ReviewNote',
          shortDescription: { text: 'AI-authored, line-anchored review note.' },
        }],
      },
    },
    results: [],
  };
  if (opts.revisionId !== undefined || opts.branch !== undefined || opts.repositoryUri !== undefined) {
    const vcs: { repositoryUri?: string; revisionId?: string; branch?: string } = {};
    if (opts.repositoryUri !== undefined) vcs.repositoryUri = opts.repositoryUri;
    if (opts.revisionId !== undefined) vcs.revisionId = opts.revisionId;
    if (opts.branch !== undefined) vcs.branch = opts.branch;
    run.versionControlProvenance = [vcs];
  }
  return run;
}

/**
 * A note body as a SARIF message: the markdown source plus the plain-text
 * rendering §3.11.9 requires beside it, so a viewer that doesn't render
 * markdown shows prose rather than raw `###` and `**`. Shared with `updateNote`
 * so both write sites stay in step.
 */
export function noteMessage(body: string): { text: string; markdown: string } {
  const flat = flattenMarkdown(body);
  // `text` must be non-empty when present; fall back to the source in the
  // pathological case where flattening leaves nothing.
  return { text: flat === '' ? body : flat, markdown: body };
}

/**
 * Map a note to a SARIF `result`. Standard fields carry everything except
 * `confidence`, which has no SARIF home and goes in the namespaced
 * `ext-ai-tool-confidence` property.
 */
export function buildResult(input: ReviewNoteInput, meta: {
  guid: string;
  snippet?: string;
  fingerprint?: string;
  /** sha-256 (hex) per artifact uri, recorded on the attachment for verification. */
  artifactHashes?: Record<string, string>;
}): Record<string, unknown> {
  const region: Record<string, unknown> = { startLine: input.startLine, endLine: input.endLine };
  if (meta.snippet !== undefined) region.snippet = { text: meta.snippet };

  const properties: Record<string, unknown> = { tags: [input.kind] };
  if (input.confidence !== undefined) properties[CONFIDENCE_PROPERTY_KEY] = input.confidence;

  const result: Record<string, unknown> = {
    ruleId: REVIEW_NOTE_RULE_ID,
    ruleIndex: 0,
    kind: 'informational',
    level: input.kind === 'risk' ? 'warning' : 'none',
    guid: meta.guid,
    message: noteMessage(input.body),
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: input.file },
        region,
      },
    }],
    properties,
  };
  // SARIF §3.11.6 embedded links: a body writes `[text](N)` where N indexes
  // this array, and the viewer resolves it to a real file+line.
  if (input.related !== undefined && input.related.length > 0) {
    result.relatedLocations = input.related.map((loc, index) => ({
      id: index,
      physicalLocation: {
        artifactLocation: { uri: loc.uri },
        region: { startLine: loc.line },
      },
    }));
  }
  if (input.rank !== undefined) result.rank = input.rank;
  if (input.ticket !== undefined && input.ticket !== '') result.workItemUris = [input.ticket];
  if (meta.fingerprint !== undefined) result.partialFingerprints = { [ANCHOR_FINGERPRINT_KEY]: meta.fingerprint };
  if (input.artifacts !== undefined && input.artifacts.length > 0) {
    result.attachments = input.artifacts.map(uri => {
      const artifactLocation: Record<string, unknown> = { uri };
      const hash = meta.artifactHashes?.[uri];
      if (hash !== undefined) artifactLocation.properties = { 'ext-sha256': hash };
      return { artifactLocation };
    });
  }
  return result;
}
