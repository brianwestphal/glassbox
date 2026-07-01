import { describe, expect, it } from 'vitest';

import {
  type CoverageMap,
  extractRequirementUnits,
  findCoverageGaps,
} from '../../../scripts/check-features.js';

describe('extractRequirementUnits', () => {
  it('extracts explicit FR-/NFR- bold ids with titles', () => {
    const md = [
      '# 24. Foo',
      '',
      '- **FR-24.1 — Mode.** For a two-sided image change...',
      '- **FR-24.2 — Default.** Side by Side is the default...',
      '- **NFR-24.1 — No new transport.** Adds no new route...',
    ].join('\n');
    const units = extractRequirementUnits(md, 24);
    expect(units.map((u) => u.id)).toEqual(['FR-24.1', 'FR-24.2', 'NFR-24.1']);
    expect(units[0].title).toBe('Mode');
    expect(units[0].doc).toBe(24);
  });

  it('dedupes repeated ids (an id referenced more than once)', () => {
    const md = '**FR-1.1 — A.** ... later **FR-1.1** again ... **FR-1.2 — B.**';
    const units = extractRequirementUnits(md, 1);
    expect(units.map((u) => u.id)).toEqual(['FR-1.1', 'FR-1.2']);
  });

  it('falls back to numbered subsection headings when a doc has no FR-/NFR- ids', () => {
    const md = [
      '# 1. Review Workflow',
      '## Functional Requirements',
      '### 1.1 Review Creation',
      'prose',
      '### 1.2 Review Resumption',
      '#### 1.2.1 Nested',
    ].join('\n');
    const units = extractRequirementUnits(md, 1);
    expect(units.map((u) => u.id)).toEqual(['1.1', '1.2', '1.2.1']);
    expect(units[0].title).toBe('Review Creation');
  });

  it('prefers FR-/NFR- ids over subsection headings when both are present', () => {
    const md = ['### 24.1 Grouping heading', '- **FR-24.1 — Mode.** ...'].join('\n');
    const units = extractRequirementUnits(md, 24);
    expect(units.map((u) => u.id)).toEqual(['FR-24.1']);
  });

  it('returns nothing for a doc with neither form', () => {
    expect(extractRequirementUnits('# Title\n\njust prose', 3)).toEqual([]);
  });
});

describe('findCoverageGaps', () => {
  const units = [
    { id: 'FR-1.1', title: 'A', doc: 1 },
    { id: 'FR-1.2', title: 'B', doc: 1 },
    { id: 'FR-1.3', title: 'C', doc: 1 },
    { id: 'FR-1.4', title: 'D', doc: 1 },
  ];
  const map: CoverageMap = {
    version: 1,
    units: {
      'FR-1.1': { tests: ['a.test.ts'] },
      'FR-1.2': { tests: [] },
      'FR-1.3': { stateful: true, tests: ['c.test.ts'] },
      // FR-1.4 intentionally absent
    },
  };

  it('flags unmapped, no-test, and stateful-no-transitions units — even when line coverage is 100%', () => {
    const gaps = findCoverageGaps(units, map);
    const byId = Object.fromEntries(gaps.map((g) => [g.id, g.reason]));
    expect(byId).toEqual({
      'FR-1.2': 'no-test',
      'FR-1.3': 'stateful-no-transitions',
      'FR-1.4': 'unmapped',
    });
    // FR-1.1 is fully covered, so it is NOT a gap.
    expect(gaps.find((g) => g.id === 'FR-1.1')).toBeUndefined();
  });

  it('treats a stateful unit as covered once transitions are listed', () => {
    const withTransitions: CoverageMap = {
      version: 1,
      units: { 'FR-1.3': { stateful: true, tests: ['c.test.ts'], transitions: ['clear then refill'] } },
    };
    const gaps = findCoverageGaps([units[2]], withTransitions);
    expect(gaps).toEqual([]);
  });

  it('reports no gaps when every unit is fully covered', () => {
    const full: CoverageMap = {
      version: 1,
      units: { 'FR-1.1': { tests: ['a.test.ts'] } },
    };
    expect(findCoverageGaps([units[0]], full)).toEqual([]);
  });
});
