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

import { getReview, getReviewFiles, getAnnotationsForReview } from '../../../src/db/queries.js';

const mockGetReview = vi.mocked(getReview);
const mockGetReviewFiles = vi.mocked(getReviewFiles);
const mockGetAnnotations = vi.mocked(getAnnotationsForReview);

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

  it('includes mode_args when present', async () => {
    mockGetReview.mockResolvedValueOnce({
      id: 'r1', repo_path: '/repo', repo_name: 'repo', mode: 'commit', mode_args: 'abc123',
      head_commit: 'abc', status: 'in_progress', created_at: '2025-01-01',
    } as any);
    mockGetReviewFiles.mockResolvedValueOnce([]);
    mockGetAnnotations.mockResolvedValueOnce([]);

    const result = await generateReviewExport('r1', tempDir, true);
    const content = readFileSync(result, 'utf-8');
    expect(content).toContain('**Review mode**: commit (abc123)');
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
