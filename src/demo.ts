import { saveGuidedReviewConfig } from './ai/config.js';
import { appendFileScores, createAnalysis, saveUserPreferences, updateAnalysisStatus } from './db/ai-queries.js';
import { getDataDir } from './db/connection.js';
import { addAnnotation, addReviewFile, createReview } from './db/queries.js';
import { ANNOTATIONS, DEMO_FILES, GUIDED_NOTES, NARRATIVE_ORDER, RISK_SCORES } from './demo/fixtures.js';
import type { FileDiff } from './git/diff.js';
import { writeImageBlob } from './git/image-blobs.js';
import type { ReviewNoteView } from './review-notes/view.js';

/**
 * The SVG demo files are seeded into the DB, not committed to disk, so the
 * live-rendered `<img>` view (GB-932) — which fetches `/api/image/:fileId/:side`
 * — would 404 on the synthetic giant `src/assets/icons.min.svg` (GB-947). The
 * full bytes of each side live in the diff hunks, so we persist them to the
 * image-blob store, which the image route serves as a fallback. SVGs are
 * single-hunk full-file diffs here, so each side is the join of the lines it
 * keeps (old drops adds; new drops removes).
 */
function seedSvgBlobs(fileId: string, diff: FileDiff): void {
  if (!diff.filePath.toLowerCase().endsWith('.svg')) return;
  const dataDir = getDataDir();
  if (dataDir === null) return;
  const lines = diff.hunks.flatMap(h => h.lines);
  const sideBytes = (keep: (type: string) => boolean): Buffer =>
    Buffer.from(lines.filter(l => keep(l.type)).map(l => l.content).join('\n'), 'utf8');
  writeImageBlob(dataDir, fileId, 'old', sideBytes(t => t !== 'add'));
  writeImageBlob(dataDir, fileId, 'new', sideBytes(t => t !== 'remove'));
}

/**
 * Illustrative AI-authored review notes for the demo (docs/20 P2). Demo runs
 * against synthetic, DB-seeded diffs with no on-disk `.pr-notes/`, so the diff
 * route serves these instead to showcase the feature. Keyed to new-side lines
 * of the `src/auth/session.ts` demo file.
 */
export function demoReviewNotes(filePath: string): ReviewNoteView[] {
  if (filePath !== 'src/auth/session.ts') return [];
  return [
    // The body carries a SARIF embedded link — `[text](0)` indexes `related` —
    // which renders as a jump-to-line link into the other changed file (doc 20
    // §20.6).
    { guid: 'demo-note-rationale', line: 14, side: 'new', kind: 'rationale', body: '`createSession` is **async** now because session state moved from an in-process `Map` to [the Redis client](0); callers must `await` it.', confidence: 0.9, producer: 'Claude Code', related: [{ uri: 'src/db/redis.ts', line: 1 }] },
    // The proof note carries two artifacts: mocked test output (always a code
    // block) and a Mermaid sequence diagram — with the mermaid content plugin
    // installed it renders inline as a diagram (doc 29); without it, the
    // fail-soft code block still tells the story.
    // Body deliberately uses block markdown (paragraph + list) to showcase the
    // renderer's block support (doc 20 §20.6).
    { guid: 'demo-note-proof', line: 23, side: 'new', kind: 'proof', body: 'The TTL is written atomically with the value via the EX option, so a session can never be stored without an expiry.\n\n- `SET` carries `EX 3600` in a single round trip\n- No window exists where a session is stored without one', producer: 'Claude Code', artifacts: [
      { uri: '.pr-notes/artifacts/session-ttl.test.txt', content: 'PASS  session.test.ts\n  ✓ createSession writes value and TTL atomically (4 ms)\n  ✓ a session always has an expiry (2 ms)\n\nTests: 2 passed, 2 total' },
      { uri: '.pr-notes/artifacts/session-flow.mmd', content: 'sequenceDiagram\n    participant C as Caller\n    participant S as createSession\n    participant R as Redis\n    C->>S: createSession(userId)\n    S->>S: id = randomUUID()\n    S->>R: SET session:id {userId} EX 3600\n    Note over R: value + TTL written atomically\n    R-->>S: OK\n    S-->>C: id' },
    ] },
    { guid: 'demo-note-risk', line: 31, side: 'new', kind: 'risk', body: 'expiresAt round-trips through JSON as a string and is re-wrapped in Date() — verify the comparison holds in your runtime.', confidence: 0.6, producer: 'Claude Code', artifacts: [{ uri: 'assets/demo-annotations.png', isImage: true }] },
    // Re-anchoring showcase (P3): authored against a 16-byte id, but the code
    // now uses 32 bytes, so the note no longer matches and renders as stale.
    { guid: 'demo-note-stale', line: 15, side: 'new', kind: 'assumption', body: 'Assumed a 16-byte token id here — the implementation has since changed, so this note is out of date.', producer: 'Claude Code', snippet: "  const id = randomBytes(16).toString('hex');" },
  ];
}

export interface DemoScenario {
  id: number;
  label: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  { id: 1, label: 'Main UI with guided review notes' },
  { id: 2, label: 'Risk mode with inline risk notes' },
  { id: 3, label: 'Narrative mode with walkthrough notes' },
  { id: 4, label: 'Annotations with different categories' },
  { id: 5, label: 'Settings dialog with guided review' },
  { id: 6, label: 'Direct comparison (--diff) of two folders' },
  { id: 7, label: 'AI review notes inline with the diff' },
];


// --- Setup functions ---

export async function setupDemoReview(scenario: number): Promise<{ reviewId: string }> {
  const repoRoot = process.cwd();

  // Scenario 6 fakes the `--diff <A> <B>` direct-comparison mode (doc 18) so a
  // screenshot can show the `compare: A ↔ B` label and the relative-path file
  // list. The other scenarios use the generic "demo" mode label.
  const isDiffDemo = scenario === 6;
  const repoName = isDiffDemo ? 'dist-old ↔ dist-new' : 'demo-project';
  const mode = isDiffDemo
    ? `diff:${JSON.stringify(['/Users/you/dist-old', '/Users/you/dist-new'])}`
    : 'demo';
  const modeArgs = isDiffDemo ? 'dist-old ↔ dist-new' : `scenario-${String(scenario)}`;

  // Create review
  const review = await createReview(repoRoot, repoName, mode, modeArgs);

  // Add files
  const fileIdMap = new Map<string, string>();
  for (const file of DEMO_FILES) {
    const diff: FileDiff = {
      filePath: file.path,
      oldPath: file.oldPath ?? null,
      status: file.status,
      hunks: file.hunks,
      isBinary: file.isBinary ?? false,
    };
    const rf = await addReviewFile(review.id, file.path, JSON.stringify(diff));
    fileIdMap.set(file.path, rf.id);
    seedSvgBlobs(rf.id, diff);
  }

  // Common: mark some files as reviewed
  const { updateFileStatus } = await import('./db/queries.js');
  const reviewedPaths = ['src/utils/password.ts', 'src/db/redis.ts', 'package.json'];
  for (const p of reviewedPaths) {
    const fid = fileIdMap.get(p);
    if (fid !== undefined) await updateFileStatus(fid, 'reviewed');
  }

  // Scenario-specific setup
  switch (scenario) {
    case 1: // Main UI with guided review notes
      await setupGuidedNotes(review.id, fileIdMap);
      saveGuidedReviewConfig({ enabled: true, topics: ['codebase', 'typescript'] });
      await saveUserPreferences({ sort_mode: 'folder' });
      break;

    case 2: // Risk mode
      await setupRiskScores(review.id, fileIdMap);
      await saveUserPreferences({ sort_mode: 'risk', show_risk_scores: true });
      break;

    case 3: // Narrative mode
      await setupNarrativeOrder(review.id, fileIdMap);
      await saveUserPreferences({ sort_mode: 'narrative' });
      break;

    case 4: // Annotations
      await setupAnnotations(fileIdMap);
      await saveUserPreferences({ sort_mode: 'folder' });
      break;

    case 5: // Settings dialog (just needs guided review enabled)
      saveGuidedReviewConfig({ enabled: true, topics: ['programming', 'codebase', 'typescript', 'javascript'] });
      await saveUserPreferences({ sort_mode: 'folder' });
      break;

    case 6: // Direct comparison (--diff) — visible difference is the
      // `compare: A ↔ B` sidebar label and the lack of git history; reuses
      // the standard demo files for content.
      await saveUserPreferences({ sort_mode: 'folder' });
      break;

    case 7: // AI review notes — session.ts carries the illustrative review
      // notes (rationale / proof / risk / outdated) via `demoReviewNotes`;
      // seed the one human reply so the threading story is visible too.
      await setupReviewNoteReply(fileIdMap);
      await saveUserPreferences({ sort_mode: 'folder' });
      break;

    default:
      break;
  }

  return { reviewId: review.id };
}

async function setupGuidedNotes(reviewId: string, fileIdMap: Map<string, string>) {
  const analysis = await createAnalysis(reviewId, 'guided');
  const scores = Object.entries(GUIDED_NOTES).map(([path, notes], idx) => ({
    reviewFileId: fileIdMap.get(path) ?? '',
    filePath: path,
    sortOrder: idx,
    aggregateScore: null,
    rationale: null,
    dimensionScores: null,
    notes,
  }));
  await appendFileScores(analysis.id, scores);
  await updateAnalysisStatus(analysis.id, 'completed');
}

async function setupRiskScores(reviewId: string, fileIdMap: Map<string, string>) {
  const analysis = await createAnalysis(reviewId, 'risk');
  const sorted = RISK_SCORES.slice().sort((a, b) => b.aggregate - a.aggregate);
  const scores = sorted.map((r, idx) => ({
    reviewFileId: fileIdMap.get(r.path) ?? '',
    filePath: r.path,
    sortOrder: idx,
    aggregateScore: r.aggregate,
    rationale: r.rationale,
    dimensionScores: r.scores,
    notes: r.notes,
  }));
  await appendFileScores(analysis.id, scores);
  await updateAnalysisStatus(analysis.id, 'completed');
}

async function setupNarrativeOrder(reviewId: string, fileIdMap: Map<string, string>) {
  const analysis = await createAnalysis(reviewId, 'narrative');
  const scores = NARRATIVE_ORDER.map(r => ({
    reviewFileId: fileIdMap.get(r.path) ?? '',
    filePath: r.path,
    sortOrder: r.position,
    aggregateScore: null,
    rationale: r.rationale,
    dimensionScores: null,
    notes: r.notes,
  }));
  await appendFileScores(analysis.id, scores);
  await updateAnalysisStatus(analysis.id, 'completed');
}

async function setupAnnotations(fileIdMap: Map<string, string>) {
  for (const ann of ANNOTATIONS) {
    const fileId = fileIdMap.get(ann.filePath);
    if (fileId !== undefined) {
      await addAnnotation(fileId, ann.line, ann.side, ann.category, ann.content, ann.replyToNoteId);
    }
  }
}

/**
 * Seeds only the single human reply threaded onto the line-31 risk review note
 * (`demo-note-risk`), so the AI-review-notes scenario shows the full threading
 * loop — AI note plus a reviewer's reply nested beneath it — without the rest of
 * the annotation set cluttering the diff.
 */
async function setupReviewNoteReply(fileIdMap: Map<string, string>) {
  const reply = ANNOTATIONS.find(a => a.replyToNoteId !== undefined);
  if (reply === undefined) return;
  const fileId = fileIdMap.get(reply.filePath);
  if (fileId !== undefined) {
    await addAnnotation(fileId, reply.line, reply.side, reply.category, reply.content, reply.replyToNoteId);
  }
}
