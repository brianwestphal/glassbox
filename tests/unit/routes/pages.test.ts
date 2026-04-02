import { Hono } from 'hono';

import type { AppEnv } from '../../../src/types.js';

// Mock database queries
vi.mock('../../../src/db/queries.js', () => ({
  getReview: vi.fn(),
  getReviewFiles: vi.fn(),
  getReviewFile: vi.fn(),
  getAnnotationsForFile: vi.fn(),
  listReviews: vi.fn(),
}));

// Mock git operations
vi.mock('../../../src/git/diff.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/git/diff.js')>();
  return { ...actual, getSingleFileDiff: vi.fn() };
});
vi.mock('../../../src/git/image.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/git/image.js')>();
  return { ...actual, getOldImage: vi.fn(), getNewImage: vi.fn() };
});

import { getAnnotationsForFile, getReview, getReviewFile, getReviewFiles, listReviews } from '../../../src/db/queries.js';
import { pageRoutes } from '../../../src/routes/pages.js';

function createApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('reviewId', 'r-current');
    c.set('currentReviewId', 'r-current');
    c.set('repoRoot', '/fake/repo');
    await next();
  });
  app.route('/', pageRoutes);
  return app;
}

const mockReview = {
  id: 'r-current', repo_path: '/fake/repo', repo_name: 'test-repo',
  mode: 'uncommitted', mode_args: null, status: 'in_progress',
  branch_name: null, created_at: '', completed_at: null,
};

const mockFile = {
  id: 'f1', review_id: 'r-current', file_path: 'src/app.ts',
  status: 'pending', diff_data: JSON.stringify({
    filePath: 'src/app.ts', oldPath: null, status: 'modified', isBinary: false,
    hunks: [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
      lines: [{ type: 'context', oldNum: 1, newNum: 1, content: 'hello' }] }],
  }),
};

describe('pageRoutes', () => {
  const app = createApp();

  beforeEach(() => {
    vi.mocked(getReview).mockResolvedValue(mockReview as any);
    vi.mocked(getReviewFiles).mockResolvedValue([mockFile] as any);
    vi.mocked(getAnnotationsForFile).mockResolvedValue([]);
    vi.mocked(getReviewFile).mockResolvedValue(mockFile as any);
    vi.mocked(listReviews).mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('GET /', () => {
    it('renders the main review page', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('test-repo');
      expect(html).toContain('review-app');
      expect(html).toContain('sidebar');
      expect(html).toContain('file-list');
    });

    it('returns 404 when review not found', async () => {
      vi.mocked(getReview).mockResolvedValue(undefined as any);
      const res = await app.request('/');
      expect(res.status).toBe(404);
    });

    it('shows review mode info', async () => {
      vi.mocked(getReview).mockResolvedValue({ ...mockReview, mode_args: 'main' } as any);
      const res = await app.request('/');
      const html = await res.text();
      expect(html).toContain('uncommitted');
      expect(html).toContain('main');
    });
  });

  describe('GET /file/:fileId', () => {
    it('renders file diff in split mode by default', async () => {
      const res = await app.request('/file/f1');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('diff-view');
    });

    it('renders file diff in unified mode', async () => {
      const res = await app.request('/file/f1?mode=unified');
      const html = await res.text();
      expect(html).toContain('diff-table-unified');
    });

    it('returns 404 for missing file', async () => {
      vi.mocked(getReviewFile).mockResolvedValue(undefined as any);
      const res = await app.request('/file/missing');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /file-raw', () => {
    it('returns 400 when path is missing', async () => {
      const res = await app.request('/file-raw');
      expect(res.status).toBe(400);
    });

    it('returns 404 when file does not exist', async () => {
      const res = await app.request('/file-raw?path=nonexistent.ts');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /review/:reviewId', () => {
    it('redirects to / when viewing current review', async () => {
      const res = await app.request('/review/r-current', { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    });

    it('renders a different review page', async () => {
      const otherReview = { ...mockReview, id: 'r-other', status: 'completed' };
      vi.mocked(getReview).mockResolvedValue(otherReview as any);
      vi.mocked(getReviewFiles).mockResolvedValue([mockFile] as any);
      const res = await app.request('/review/r-other');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('review-app');
      expect(html).toContain('Reopen Review');
    });

    it('returns 404 for unknown review', async () => {
      vi.mocked(getReview).mockResolvedValue(undefined as any);
      const res = await app.request('/review/r-unknown');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /history', () => {
    it('renders the history page', async () => {
      vi.mocked(listReviews).mockResolvedValue([mockReview] as any);
      const res = await app.request('/history');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Review History');
    });
  });
});
