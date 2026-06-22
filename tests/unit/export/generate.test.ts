import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateReviewExport, isGlassboxGitignored, shouldPromptGitignore, addGlassboxToGitignore, dismissGitignorePrompt, deleteReviewExport } from '../../../src/export/generate.js';

// Mock the database queries
vi.mock('../../../src/db/queries.js', () => ({
  getReview: vi.fn(),
  getReviewFiles: vi.fn(),
  getAnnotationsForReview: vi.fn(),
}));

// The export folds in attachment paths (doc 25); default to none.
vi.mock('../../../src/db/attachment-queries.js', () => ({
  getAttachmentsForReview: vi.fn(() => Promise.resolve([])),
}));

import { getReview, getReviewFiles, getAnnotationsForReview } from '../../../src/db/queries.js';
import { getAttachmentsForReview } from '../../../src/db/attachment-queries.js';
import { writeReviewNote } from '../../../src/review-notes/store.js';

const mockGetReview = vi.mocked(getReview);
const mockGetReviewFiles = vi.mocked(getReviewFiles);
const mockGetAnnotations = vi.mocked(getAnnotationsForReview);
const mockGetAttachments = vi.mocked(getAttachmentsForReview);

describe('generateReviewExport', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `glassbox-test-export-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('throws when review not found', async () => {
    mockGetReview.mockResolvedValueOnce(null);
    await expect(generateReviewExport('missing-id', tempDir, true)).rejects.toThrow('Review not found');
  });

  it('generates markdown with header', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'test-review',
      repo_path: '/repo',
      repo_name: 'my-repo',
      mode: 'uncommitted',
      mode_args: '',
      head_commit: 'abc123',
      status: 'in_progress',
      created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([]);

    const result = await generateReviewExport('test-review', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('# Code Review');
    expect(content).toContain('**Repository**: my-repo');
    expect(content).toContain('**Review mode**: uncommitted');
    expect(content).toContain('**Review ID**: test-review');
    expect(content).toContain('**Total annotations**: 0');
  });

  it('includes annotation summary by category', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'staged', mode_args: null,
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([
      { id: 'a1', file_path: 'a.ts', line_number: 1, side: 'new', category: 'bug', content: 'Bug here', stale: false },
      { id: 'a2', file_path: 'a.ts', line_number: 5, side: 'new', category: 'bug', content: 'Another bug', stale: false },
      { id: 'a3', file_path: 'b.ts', line_number: 10, side: 'new', category: 'style', content: 'Style issue', stale: false },
    ] as any);

    const result = await generateReviewExport('r1', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('## Annotation Summary');
    expect(content).toContain('**bug**: 2');
    expect(content).toContain('**style**: 1');
  });

  it('lists attachment paths under their annotation (doc 25)', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'staged', mode_args: null,
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([
      { id: 'a1', file_path: 'a.ts', line_number: 1, side: 'new', category: 'bug', content: 'Bug here', stale: false },
    ] as any);
    mockGetAttachments.mockResolvedValueOnce([
      { id: 'at1', annotation_id: 'a1', original_filename: 'shot.png', stored_path: '/data/attachments/at1-shot.png', mime_type: 'image/png', size: 9, sha256: null, created_at: '2025-01-01', file_path: 'a.ts', line_number: 1 },
    ] as any);

    const content = readFileSync(await generateReviewExport('r1', tempDir, true), 'utf-8');
    expect(content).toContain('Attachments (readable files on disk):');
    expect(content).toContain('/data/attachments/at1-shot.png');
    expect(content).toContain('(shot.png)');
    // The AI instructions mention attachments are readable files.
    expect(content).toContain('**Attachments** listed under an annotation are real files');
  });

  it('includes Items to Remember section for remember annotations', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'uncommitted', mode_args: null,
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([
      { id: 'a1', file_path: 'config.ts', line_number: 42, side: 'new', category: 'remember', content: 'Always validate inputs', stale: false },
    ] as any);

    const result = await generateReviewExport('r1', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('## Items to Remember');
    expect(content).toContain('**config.ts:42** - Always validate inputs');
  });

  it('folds AI review notes from .pr-notes/ into the export (GB-899)', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'uncommitted', mode_args: null,
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([
      { id: 'f1', review_id: 'r1', file_path: 'src/app.ts', status: 'reviewed', diff_data: null },
    ] as any);
    mockGetAnnotations.mockResolvedValueOnce([]);

    // Write a review note into the temp repo (tempDir is the repoRoot).
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src/app.ts'), 'a\nb\nc\n', 'utf-8');
    writeReviewNote(tempDir, { file: 'src/app.ts', startLine: 2, endLine: 2, body: 'why this is safe', kind: 'proof', producer: 'Claude Code' });

    const result = await generateReviewExport('r1', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('## AI Review Notes');
    expect(content).toContain('### src/app.ts');
    expect(content).toContain('**Line 2** [proof]: why this is safe');
  });

  it('includes per-file annotations', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'commit', mode_args: 'abc123',
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([
      { id: 'a1', file_path: 'src/app.ts', line_number: 10, side: 'new', category: 'fix', content: 'Fix null check', stale: false },
    ] as any);

    const result = await generateReviewExport('r1', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('### src/app.ts');
    expect(content).toContain('**Line 10** [fix]: Fix null check');
  });

  it('renders image-level annotations distinctly (doc 23)', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'commit', mode_args: 'abc123',
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([
      { id: 'i1', file_path: 'logo.png', line_number: 0, side: 'new', category: 'note', content: 'Looks washed out', stale: false, region_data: null },
      { id: 'i2', file_path: 'logo.png', line_number: 0, side: 'new', category: 'bug', content: 'Misaligned mark', stale: false, region_data: '{"x":0.1,"y":0.2,"w":0.3,"h":0.25}' },
    ] as any);

    const result = await generateReviewExport('r1', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('### logo.png');
    expect(content).toContain('**Image comment** [note]: Looks washed out');
    expect(content).toContain('**Image region (10%, 20%, 30%×25%)** [bug]: Misaligned mark');
  });

  it('includes AI tool instructions', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'uncommitted', mode_args: null,
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([]);

    const result = await generateReviewExport('r1', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('## Instructions for AI Tools');
    expect(content).toContain('**bug** and **fix**');
    expect(content).toContain('**remember** annotations');
  });

  it('writes latest-review.md when isCurrent is true', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'uncommitted', mode_args: null,
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([]);

    const result = await generateReviewExport('r1', tempDir, true);
    expect(result).toContain('latest-review.md');
    expect(existsSync(join(tempDir, '.glassbox', 'latest-review.md'))).toBe(true);
    expect(existsSync(join(tempDir, '.glassbox', 'review-r1.md'))).toBe(true);
  });

  it('writes only archive when isCurrent is false', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'uncommitted', mode_args: null,
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([]);

    const result = await generateReviewExport('r1', tempDir, false);
    expect(result).toContain('review-r1.md');
    expect(existsSync(join(tempDir, '.glassbox', 'review-r1.md'))).toBe(true);
    expect(existsSync(join(tempDir, '.glassbox', 'latest-review.md'))).toBe(false);
  });

  it('preserves the full ref in the mode line without double-printing', async () => {
    // The stored `mode` already contains the ref (e.g. `commit:abc123def…`),
    // so the export now emits `mode` verbatim instead of appending
    // `(${mode_args})` — the parenthetical was redundant in every production
    // case and produced `commit:abc… (abc…)`.
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'commit:abc123def4567890', mode_args: 'abc123def4567890',
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([]);

    const result = await generateReviewExport('r1', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('**Review mode**: commit:abc123def4567890');
    // The ref must appear exactly once on the mode line.
    const modeLine = content.split('\n').find(l => l.includes('Review mode')) ?? '';
    expect(modeLine.match(/abc123def4567890/g)?.length ?? 0).toBe(1);
  });
});

describe('deleteReviewExport', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `glassbox-test-delete-${Date.now()}`);
    mkdirSync(join(tempDir, '.glassbox'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('deletes the archive file', () => {
    const archivePath = join(tempDir, '.glassbox', 'review-r1.md');
    writeFileSync(archivePath, 'content');
    deleteReviewExport('r1', tempDir);
    expect(existsSync(archivePath)).toBe(false);
  });

  it('does nothing if file does not exist', () => {
    // Should not throw
    deleteReviewExport('nonexistent', tempDir);
  });
});

describe('addGlassboxToGitignore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `glassbox-test-gitignore-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates .gitignore with .glassbox/ if not exists', () => {
    addGlassboxToGitignore(tempDir);
    const content = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('.glassbox/\n');
  });

  it('appends to existing .gitignore ending with newline', () => {
    writeFileSync(join(tempDir, '.gitignore'), 'node_modules/\n');
    addGlassboxToGitignore(tempDir);
    const content = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\n.glassbox/\n');
  });

  it('appends newline before .glassbox/ if .gitignore does not end with newline', () => {
    writeFileSync(join(tempDir, '.gitignore'), 'node_modules/');
    addGlassboxToGitignore(tempDir);
    const content = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\n.glassbox/\n');
  });
});
