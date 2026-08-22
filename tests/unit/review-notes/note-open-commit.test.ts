/**
 * Unit test for the "Open commit" button on a review note's origin-commit label
 * (doc 34, GB-1144): it renders with the sha + the note's file/line as data-*.
 */
import { describe, expect, it } from 'vitest';

import { renderReviewNoteRowsHtml } from '../../../src/components/diffView.js';
import type { ReviewNoteView } from '../../../src/review-notes/view.js';

function noteWithOrigin(overrides: Partial<ReviewNoteView> = {}): ReviewNoteView {
  return {
    guid: 'n1',
    line: 42,
    side: 'new',
    kind: 'rationale',
    body: 'Because reasons.',
    origin: { sha: 'a1b2c3d4e5f6', shortSha: 'a1b2c3d', subject: 'Do the thing' },
    ...overrides,
  };
}

describe('open-commit button (doc 34)', () => {
  it('renders the button with the sha + the note file/line', () => {
    const html = renderReviewNoteRowsHtml([noteWithOrigin()], {}, 'src/app.ts');
    expect(html).toContain('class="ai-note-open-commit"');
    expect(html).toContain('data-open-commit="a1b2c3d4e5f6"');
    expect(html).toContain('data-open-file="src/app.ts"');
    expect(html).toContain('data-open-line="42"');
  });

  it('does not render the button when the note has no origin commit', () => {
    const html = renderReviewNoteRowsHtml([noteWithOrigin({ origin: undefined })], {}, 'src/app.ts');
    expect(html).not.toContain('ai-note-open-commit');
    expect(html).not.toContain('ai-note-commit-wrap');
  });

  it('escapes a file path with special characters into the data attribute', () => {
    const html = renderReviewNoteRowsHtml([noteWithOrigin()], {}, 'src/a "b".ts');
    // The kerf runtime escapes the double-quotes so they cannot break out of the attribute.
    expect(html).not.toContain('data-open-file="src/a "b".ts"');
    expect(html).toContain('&quot;');
  });
});
