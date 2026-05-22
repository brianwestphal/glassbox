import { describe, expect, it } from 'vitest';

import { ReviewShell } from '../../../src/components/reviewShell.js';
import { raw } from 'kerfjs';

const baseReview = {
  id: 'r-1',
  repo_path: '/repo',
  repo_name: 'my-repo',
  mode: 'uncommitted',
  mode_args: null,
  head_commit: 'abc',
  status: 'in_progress',
  created_at: '2025-01-01T00:00:00Z',
};

function shell(reviewOverrides: Partial<typeof baseReview> & Record<string, unknown> = {}) {
  return ReviewShell({
    reviewId: 'r-1',
    review: { ...baseReview, ...reviewOverrides } as any,
    files: [],
    annotationCounts: {},
    staleCounts: {},
    footer: raw(''),
  }).toString();
}

describe('ReviewShell — review-mode label', () => {
  it('renders the no-arg mode "uncommitted" as-is', () => {
    const html = shell();
    expect(html).toContain('<span class="review-mode">uncommitted</span>');
  });

  it('shortens a 40-char SHA in commit mode to 7 chars and does NOT double-print', () => {
    const sha = '84a7998acaddea5d1acc385a07d2eb8dc4d0173c';
    const html = shell({ mode: `commit:${sha}`, mode_args: sha });
    expect(html).toContain('<span class="review-mode">commit: 84a7998</span>');
    // Regression check for the bug reported in the screenshot: the full SHA
    // must not appear in the sidebar header at all (it used to render twice).
    expect(html).not.toContain(sha);
  });

  it('shortens both endpoints of a range when both are full SHAs', () => {
    const from = '84a7998acaddea5d1acc385a07d2eb8dc4d0173c';
    const to = 'bd5d574acaddea5d1acc385a07d2eb8dc4d0173c';
    const html = shell({ mode: `range:${from}..${to}`, mode_args: `${from}..${to}` });
    expect(html).toContain('<span class="review-mode">range: 84a7998..bd5d574</span>');
  });

  it('leaves branch-name endpoints alone in range mode', () => {
    const html = shell({ mode: 'range:main..HEAD', mode_args: 'main..HEAD' });
    expect(html).toContain('<span class="review-mode">range: main..HEAD</span>');
  });

  it('renders a branch name in branch mode', () => {
    const html = shell({ mode: 'branch:feature/x', mode_args: 'feature/x' });
    expect(html).toContain('<span class="review-mode">branch: feature/x</span>');
  });

  it('renders the file pattern list in files mode', () => {
    const html = shell({ mode: 'files:src/a.ts,src/b.ts', mode_args: 'src/a.ts,src/b.ts' });
    expect(html).toContain('<span class="review-mode">files: src/a.ts,src/b.ts</span>');
  });
});
