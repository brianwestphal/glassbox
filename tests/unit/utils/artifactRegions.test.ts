import { describe, expect, it } from 'vitest';

import { groupRegionsByArtifact, parseArtifactRegions } from '../../../src/utils/artifactRegions.js';

// doc 25 / GB-959 — decode + group the marked regions a reply carries.
describe('parseArtifactRegions', () => {
  it('parses a single region object (the legacy GB-953 shape)', () => {
    const data = JSON.stringify({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, artifact: 'a.png' });
    const regions = parseArtifactRegions(data);
    expect(regions).toHaveLength(1);
    expect(regions[0].artifact).toBe('a.png');
  });

  it('parses a JSON array of regions (GB-959)', () => {
    const data = JSON.stringify([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2, artifact: 'a.png' },
      { x: 0.5, y: 0.5, w: 0.2, h: 0.2, artifact: 'a.png' },
    ]);
    expect(parseArtifactRegions(data)).toHaveLength(2);
  });

  it('drops regions without an artifact (ordinary image-diff regions, doc 23)', () => {
    const data = JSON.stringify([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { x: 0.5, y: 0.5, w: 0.2, h: 0.2, artifact: 'a.png' },
    ]);
    const regions = parseArtifactRegions(data);
    expect(regions).toHaveLength(1);
    expect(regions[0].artifact).toBe('a.png');
  });

  it('tolerates null, empty, malformed, and out-of-range input', () => {
    expect(parseArtifactRegions(null)).toEqual([]);
    expect(parseArtifactRegions(undefined)).toEqual([]);
    expect(parseArtifactRegions('')).toEqual([]);
    expect(parseArtifactRegions('not json')).toEqual([]);
    // x > 1 fails ImageRegionSchema.
    expect(parseArtifactRegions(JSON.stringify({ x: 2, y: 0, w: 0.1, h: 0.1, artifact: 'a.png' }))).toEqual([]);
  });
});

describe('groupRegionsByArtifact', () => {
  it('groups by artifact uri, preserving first-seen order', () => {
    const groups = groupRegionsByArtifact([
      { x: 0, y: 0, w: 0.1, h: 0.1, artifact: 'b.png' },
      { x: 0, y: 0, w: 0.1, h: 0.1, artifact: 'a.png' },
      { x: 0.5, y: 0.5, w: 0.1, h: 0.1, artifact: 'b.png' },
    ]);
    expect(groups.map(g => g.artifact)).toEqual(['b.png', 'a.png']);
    expect(groups[0].regions).toHaveLength(2);
    expect(groups[1].regions).toHaveLength(1);
  });

  it('returns [] for no regions', () => {
    expect(groupRegionsByArtifact([])).toEqual([]);
  });
});
