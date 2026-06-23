import { describe, expect, it } from 'vitest';

import { ReviewNoteRegionThumb } from '../../../src/components/reviewNoteRegionThumb.js';

// GB-953 / GB-959 — the marked-region thumbnail(s) rendered on a note reply.
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

  it('renders multiple boxes for an array of regions on one artifact (GB-959)', () => {
    const regionData = JSON.stringify([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2, artifact: 'assets/shot.png' },
      { x: 0.6, y: 0.6, w: 0.15, h: 0.15, artifact: 'assets/shot.png' },
    ]);
    const html = ReviewNoteRegionThumb({ regionData })?.toString() ?? '';
    // One frame (same artifact), two boxes.
    expect(html.match(/ai-note-reply-region-frame/g)?.length).toBe(1);
    expect(html.match(/ai-note-reply-region-box/g)?.length).toBe(2);
    expect(html).toContain('left:10%');
    expect(html).toContain('left:60%');
  });

  it('renders one frame per distinct artifact when regions span several (GB-959)', () => {
    const regionData = JSON.stringify([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2, artifact: 'a.png' },
      { x: 0.2, y: 0.2, w: 0.2, h: 0.2, artifact: 'b.png' },
    ]);
    const html = ReviewNoteRegionThumb({ regionData })?.toString() ?? '';
    expect(html.match(/ai-note-reply-region-frame/g)?.length).toBe(2);
    expect(html).toContain('file=a.png');
    expect(html).toContain('file=b.png');
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
