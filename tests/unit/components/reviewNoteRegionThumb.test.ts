import { describe, expect, it } from 'vitest';

import { ReviewNoteRegionThumb } from '../../../src/components/reviewNoteRegionThumb.js';

// GB-953 — the marked-region thumbnail rendered on a note reply.
describe('ReviewNoteRegionThumb', () => {
  it('renders the artifact image with a positioned box when the region names an artifact', () => {
    const regionData = JSON.stringify({ x: 0.25, y: 0.5, w: 0.2, h: 0.1, artifact: 'assets/shot.png' });
    const html = ReviewNoteRegionThumb({ regionData })?.toString() ?? '';
    expect(html).toContain('ai-note-reply-region');
    expect(html).toContain('/api/review-notes/artifact?file=assets%2Fshot.png');
    // Box positioned from the normalized coords.
    expect(html).toContain('left:25%');
    expect(html).toContain('width:20%');
  });

  it('renders nothing for a region without an artifact (an ordinary image-diff region)', () => {
    const regionData = JSON.stringify({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 });
    expect(ReviewNoteRegionThumb({ regionData })).toBeNull();
  });

  it('renders nothing for null / empty / malformed region data', () => {
    expect(ReviewNoteRegionThumb({ regionData: null })).toBeNull();
    expect(ReviewNoteRegionThumb({ regionData: '' })).toBeNull();
    expect(ReviewNoteRegionThumb({ regionData: 'not json' })).toBeNull();
  });
});
