import { ReviewHistory } from '../../../src/components/reviewHistory.js';

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

describe('ReviewHistory', () => {
  it('renders empty state when no reviews', () => {
    const result = ReviewHistory({ reviews: [], currentReviewId: 'r-1' }).toString();
    expect(result).toContain('No previous reviews found');
  });

  it('renders review entries', () => {
    const reviews = [
      { ...baseReview, id: 'r-1', status: 'in_progress' },
      { ...baseReview, id: 'r-2', status: 'completed', mode: 'staged' },
    ] as any[];
    const result = ReviewHistory({ reviews, currentReviewId: 'r-1' }).toString();
    expect(result).toContain('my-repo');
    expect(result).toContain('Uncommitted');
    expect(result).toContain('Staged');
  });

  it('marks current review with badge', () => {
    const reviews = [{ ...baseReview }] as any[];
    const result = ReviewHistory({ reviews, currentReviewId: 'r-1' }).toString();
    expect(result).toContain('Current');
  });

  it('renders delete button for non-current reviews', () => {
    const reviews = [
      { ...baseReview, id: 'r-1' },
      { ...baseReview, id: 'r-2', status: 'completed' },
    ] as any[];
    const result = ReviewHistory({ reviews, currentReviewId: 'r-1' }).toString();
    expect(result).toContain('data-delete-id="r-2"');
  });

  it('renders bulk actions when other reviews exist', () => {
    const reviews = [
      { ...baseReview, id: 'r-1' },
      { ...baseReview, id: 'r-2', status: 'completed' },
    ] as any[];
    const result = ReviewHistory({ reviews, currentReviewId: 'r-1' }).toString();
    expect(result).toContain('delete-all-btn');
    expect(result).toContain('delete-completed-btn');
  });

  it('shortens long commit SHAs in mode_args', () => {
    const reviews = [
      { ...baseReview, id: 'r-1', mode: 'commit', mode_args: 'abc123def456789012345678901234567890abcd' },
    ] as any[];
    const result = ReviewHistory({ reviews, currentReviewId: 'r-1' }).toString();
    // Long SHA should be shortened to 7 chars
    expect(result).toContain('abc123d');
    // Full SHA should be in title attribute
    expect(result).toContain('abc123def456789012345678901234567890abcd');
  });

  it('renders back to current review link', () => {
    const result = ReviewHistory({ reviews: [], currentReviewId: 'r-1' }).toString();
    expect(result).toContain('Back to current review');
    expect(result).toContain('href="/"');
  });
});
