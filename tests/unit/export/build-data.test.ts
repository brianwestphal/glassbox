import { describe, expect, it } from 'vitest';

import { ReviewExportSchema } from '../../../src/api/export.js';
import { buildReviewExportData, type ImageDims } from '../../../src/export/build-data.js';
import type { Attachment, AnnotationWithFilePath, Review, ReviewFile } from '../../../src/db/schemas.js';
import type { ReviewMode } from '../../../src/git/types.js';

// doc 6 / GB-973 — the structured JSON review-export builder (pure).

const review: Review = {
  id: 'rev1', repo_path: '/r', repo_name: 'Ground truth: m.json',
  mode: 'ground-truth:{}', mode_args: null, head_commit: null,
  status: 'completed', created_at: '2026-06-23T00:00:00.000Z', updated_at: '2026-06-23T00:00:00.000Z',
};

const file = (id: string, path: string, score: number | null = null): ReviewFile => ({
  id, review_id: 'rev1', file_path: path, status: 'reviewed', diff_data: null,
  difference_score: score, created_at: '2026-06-23T00:00:00.000Z',
});

const ann = (over: Partial<AnnotationWithFilePath> & { id: string; file_path: string }): AnnotationWithFilePath => ({
  line_number: 0, review_file_id: 'f', side: 'new', category: 'bug', content: 'x',
  is_stale: false, original_content: null, reply_to_note_id: null, region_data: null,
  created_at: '2026-06-23T00:00:00.000Z', updated_at: '2026-06-23T00:00:00.000Z',
  ...over,
});

const att = (over: Partial<Attachment> & { id: string; annotation_id: string }): Attachment & { file_path: string; line_number: number } => ({
  original_filename: 'f.png', stored_path: '/a/f.png', mime_type: 'image/png', size: 1,
  sha256: null, created_at: '2026-06-23T00:00:00.000Z', file_path: 'k', line_number: 0,
  ...over,
});

const groundTruthMode: ReviewMode = {
  type: 'ground-truth',
  manifestPath: '/m/m.json',
  comparisons: [
    { key: 'cart.png', actualPath: '/m/actual/cart.png', expectedPath: '/m/expected/cart.png', label: 'Cart', expectedKind: 'spec', setLabel: 'Checkout', stepIndex: 0, stepCount: 2 },
    { key: 'pay.png', actualPath: '/m/actual/pay.png', expectedPath: '/m/expected/pay.png', label: 'Pay' },
  ],
};

const baseArgs = {
  review, mode: groundTruthMode, modeLabel: 'ground truth: m.json',
  date: '2026-06-23T00:00:00.000Z', isCurrent: true,
  resolveDims: (() => null) as (p: string) => ImageDims,
};

it('emits a valid export with the clean mode label and modeType', () => {
  const out = buildReviewExportData({
    ...baseArgs,
    files: [file('f1', 'cart.png', 0.4)],
    annotations: [ann({ id: 'a1', file_path: 'cart.png', content: 'too dark' })],
    attachments: [],
  });
  expect(() => ReviewExportSchema.parse(out)).not.toThrow();
  expect(out.review.mode).toBe('ground truth: m.json');
  expect(out.review.modeType).toBe('ground-truth');
  expect(out.review.id).toBe('rev1');
});

it('groups by comparison and omits files with no annotations', () => {
  const out = buildReviewExportData({
    ...baseArgs,
    files: [file('f1', 'cart.png', 0.4), file('f2', 'pay.png', 0)],
    annotations: [ann({ id: 'a1', file_path: 'cart.png' }), ann({ id: 'a2', file_path: 'cart.png' })],
    attachments: [],
  });
  expect(out.comparisons.map(c => c.path)).toEqual(['cart.png']); // pay.png had no annotations
  expect(out.comparisons[0].annotations.map(a => a.id)).toEqual(['a1', 'a2']);
});

it('populates ground-truth context (label/kind/paths/score/set)', () => {
  const out = buildReviewExportData({
    ...baseArgs,
    files: [file('f1', 'cart.png', 0.4)],
    annotations: [ann({ id: 'a1', file_path: 'cart.png' })],
    attachments: [],
  });
  expect(out.comparisons[0].groundTruth).toEqual({
    label: 'Cart', expectedKind: 'spec',
    actualPath: '/m/actual/cart.png', expectedPath: '/m/expected/cart.png',
    differenceScore: 0.4, setLabel: 'Checkout', stepIndex: 0, stepCount: 2,
  });
});

it('denormalizes a region to pixels against the right image by scope', () => {
  const resolveDims = (p: string): ImageDims =>
    p === '/m/actual/cart.png' ? { width: 200, height: 100 } : { width: 50, height: 50 };
  const out = buildReviewExportData({
    ...baseArgs,
    resolveDims,
    files: [file('f1', 'cart.png')],
    annotations: [
      ann({ id: 'a-new', file_path: 'cart.png', region_data: JSON.stringify({ x: 0.5, y: 0.5, w: 0.25, h: 0.5, side: 'new' }) }),
      ann({ id: 'a-old', file_path: 'cart.png', region_data: JSON.stringify({ x: 0, y: 0, w: 1, h: 1, side: 'old' }) }),
      ann({ id: 'a-both', file_path: 'cart.png', region_data: JSON.stringify({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }) }),
    ],
    attachments: [],
  });
  const byId = Object.fromEntries(out.comparisons[0].annotations.map(a => [a.id, a.region]));
  // new → actual dims (200×100)
  expect(byId['a-new']).toEqual({ normalized: { x: 0.5, y: 0.5, w: 0.25, h: 0.5 }, pixel: { x: 100, y: 50, w: 50, h: 50 }, scope: 'new' });
  // old → expected dims (50×50)
  expect(byId['a-old']).toEqual({ normalized: { x: 0, y: 0, w: 1, h: 1 }, pixel: { x: 0, y: 0, w: 50, h: 50 }, scope: 'old' });
  // unscoped → actual dims, scope 'both'
  expect(byId['a-both']?.scope).toBe('both');
  expect(byId['a-both']?.pixel).toEqual({ x: 20, y: 20, w: 60, h: 40 });
});

it('leaves pixel null when dimensions are unresolvable', () => {
  const out = buildReviewExportData({
    ...baseArgs,
    resolveDims: () => null,
    files: [file('f1', 'cart.png')],
    annotations: [ann({ id: 'a1', file_path: 'cart.png', region_data: JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2, side: 'new' }) })],
    attachments: [],
  });
  expect(out.comparisons[0].annotations[0].region?.pixel).toBeNull();
  expect(out.comparisons[0].annotations[0].region?.normalized).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
});

it('builds no region for line annotations, general comments, or note-artifact regions', () => {
  const out = buildReviewExportData({
    ...baseArgs,
    files: [file('f1', 'cart.png')],
    annotations: [
      ann({ id: 'line', file_path: 'cart.png', line_number: 42, region_data: null }),
      ann({ id: 'general', file_path: 'cart.png', region_data: null }),
      ann({ id: 'artifact', file_path: 'cart.png', region_data: JSON.stringify({ x: 0.1, y: 0.1, w: 0.2, h: 0.2, artifact: 'proof.png' }) }),
      ann({ id: 'array', file_path: 'cart.png', region_data: JSON.stringify([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]) }),
    ],
    attachments: [],
  });
  for (const a of out.comparisons[0].annotations) expect(a.region).toBeNull();
});

it('attaches each annotation\'s attachments', () => {
  const out = buildReviewExportData({
    ...baseArgs,
    files: [file('f1', 'cart.png')],
    annotations: [ann({ id: 'a1', file_path: 'cart.png' })],
    attachments: [att({ id: 'at1', annotation_id: 'a1', original_filename: 'shot.png', stored_path: '/d/shot.png' })],
  });
  expect(out.comparisons[0].annotations[0].attachments).toEqual([{ storedPath: '/d/shot.png', originalFilename: 'shot.png' }]);
});

it('emits no ground-truth context for a non-ground-truth review', () => {
  const out = buildReviewExportData({
    ...baseArgs,
    mode: { type: 'uncommitted' },
    modeLabel: 'uncommitted',
    files: [file('f1', 'src/x.ts')],
    annotations: [ann({ id: 'a1', file_path: 'src/x.ts', line_number: 10, region_data: null })],
    attachments: [],
  });
  expect(out.comparisons[0].groundTruth).toBeNull();
  expect(out.review.modeType).toBe('uncommitted');
});

it('keeps every input annotation (stays in sync with the markdown set)', () => {
  const annotations = [
    ann({ id: 'a1', file_path: 'cart.png' }),
    ann({ id: 'a2', file_path: 'cart.png' }),
    ann({ id: 'a3', file_path: 'pay.png' }),
  ];
  const out = buildReviewExportData({
    ...baseArgs,
    files: [file('f1', 'cart.png'), file('f2', 'pay.png')],
    annotations,
    attachments: [],
  });
  const exportedIds = out.comparisons.flatMap(c => c.annotations.map(a => a.id)).sort();
  expect(exportedIds).toEqual(['a1', 'a2', 'a3']);
});

describe('schema', () => {
  it('rejects a wrong schemaVersion', () => {
    expect(() => ReviewExportSchema.parse({ schemaVersion: 2, review: {}, comparisons: [] })).toThrow();
  });
});
