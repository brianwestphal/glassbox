import { describe, expect, it } from 'vitest';

import { formatReviewMode } from '../../../src/utils/formatReviewMode.js';

describe('formatReviewMode', () => {
  describe('no-arg modes', () => {
    it('passes through "uncommitted"', () => {
      expect(formatReviewMode('uncommitted', null)).toBe('uncommitted');
    });

    it('passes through "staged"', () => {
      expect(formatReviewMode('staged', null)).toBe('staged');
    });

    it('passes through "unstaged"', () => {
      expect(formatReviewMode('unstaged', null)).toBe('unstaged');
    });

    it('passes through "all"', () => {
      expect(formatReviewMode('all', null)).toBe('all');
    });

    it('does not double-print when mode_args is somehow present on a no-arg mode', () => {
      // Defensive: an old row that mistakenly has mode_args set on a no-arg mode
      // should still render as just the mode label.
      expect(formatReviewMode('uncommitted', 'ignored')).toBe('uncommitted');
    });
  });

  describe('commit mode', () => {
    it('shortens a 40-char SHA to 7 chars', () => {
      const sha = '84a7998acaddea5d1acc385a07d2eb8dc4d0173c';
      expect(formatReviewMode(`commit:${sha}`, sha)).toBe('commit: 84a7998');
    });

    it('renders mode_args once (does not duplicate after the colon)', () => {
      // The bug being fixed: the old template printed "{mode}: {mode_args}",
      // yielding "commit:abc…: abc…". The formatter must produce a single SHA.
      const sha = '84a7998acaddea5d1acc385a07d2eb8dc4d0173c';
      const out = formatReviewMode(`commit:${sha}`, sha);
      const matches = out.match(/84a7998/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('shortens with uppercase hex too', () => {
      const sha = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
      expect(formatReviewMode(`commit:${sha}`, sha)).toBe('commit: ABCDEF0');
    });

    it('falls back to mode-embedded sha when mode_args is null', () => {
      const sha = '84a7998acaddea5d1acc385a07d2eb8dc4d0173c';
      expect(formatReviewMode(`commit:${sha}`, null)).toBe('commit: 84a7998');
    });

    it('falls back to mode-embedded sha when mode_args is empty string', () => {
      const sha = '84a7998acaddea5d1acc385a07d2eb8dc4d0173c';
      expect(formatReviewMode(`commit:${sha}`, '')).toBe('commit: 84a7998');
    });

    it('leaves a non-hash ref intact (e.g. HEAD, HEAD~1)', () => {
      expect(formatReviewMode('commit:HEAD', 'HEAD')).toBe('commit: HEAD');
      expect(formatReviewMode('commit:HEAD~3', 'HEAD~3')).toBe('commit: HEAD~3');
    });

    it('leaves an already-short hash intact', () => {
      expect(formatReviewMode('commit:84a7998', '84a7998')).toBe('commit: 84a7998');
    });
  });

  describe('range mode', () => {
    it('shortens both endpoints when both are full SHAs', () => {
      const from = '84a7998acaddea5d1acc385a07d2eb8dc4d0173c';
      const to = 'bd5d574acaddea5d1acc385a07d2eb8dc4d0173c';
      expect(formatReviewMode(`range:${from}..${to}`, `${from}..${to}`)).toBe('range: 84a7998..bd5d574');
    });

    it('shortens only the SHA endpoint when one side is a branch name', () => {
      const sha = '84a7998acaddea5d1acc385a07d2eb8dc4d0173c';
      expect(formatReviewMode(`range:main..${sha}`, `main..${sha}`)).toBe('range: main..84a7998');
      expect(formatReviewMode(`range:${sha}..HEAD`, `${sha}..HEAD`)).toBe('range: 84a7998..HEAD');
    });

    it('leaves both endpoints alone when neither is a full SHA', () => {
      expect(formatReviewMode('range:main..HEAD', 'main..HEAD')).toBe('range: main..HEAD');
    });
  });

  describe('branch mode', () => {
    it('renders the branch name', () => {
      expect(formatReviewMode('branch:feature/x', 'feature/x')).toBe('branch: feature/x');
    });
  });

  describe('files mode', () => {
    it('renders a single pattern', () => {
      expect(formatReviewMode('files:src/foo.ts', 'src/foo.ts')).toBe('files: src/foo.ts');
    });

    it('renders multiple comma-separated patterns', () => {
      expect(formatReviewMode('files:src/foo.ts,src/bar.ts', 'src/foo.ts,src/bar.ts'))
        .toBe('files: src/foo.ts,src/bar.ts');
    });
  });

  describe('diff (direct comparison) mode', () => {
    it('prefers the basename label from mode_args', () => {
      expect(formatReviewMode('diff:["/x/old.ts","/y/new.ts"]', 'old.ts ↔ new.ts'))
        .toBe('compare: old.ts ↔ new.ts');
    });

    it('derives basenames from the JSON mode string when mode_args is absent', () => {
      expect(formatReviewMode('diff:["/x/old.ts","/y/new.ts"]', null))
        .toBe('compare: old.ts ↔ new.ts');
    });

    it('falls back to a bare label on malformed JSON', () => {
      expect(formatReviewMode('diff:garbage', null)).toBe('compare');
    });
  });

  describe('ground-truth mode (doc 26)', () => {
    // The real serialized shape `getModeString` produces: a `ground-truth:` prefix
    // followed by the full {manifestPath, comparisons[]} JSON. The comparisons
    // array can carry dozens of absolute-path entries, so rendering it raw made
    // the sidebar "source" label gigantic and useless (GB-971).
    const bigMode =
      'ground-truth:' +
      JSON.stringify({
        manifestPath: '/Users/me/project/tests/fixtures/ground-truth/manifest.json',
        comparisons: Array.from({ length: 20 }, (_, i) => ({
          key: `actual/img${String(i)}.png`,
          actualPath: `/Users/me/project/tests/fixtures/ground-truth/actual/img${String(i)}.png`,
          expectedPath: `/Users/me/project/tests/fixtures/ground-truth/expected/img${String(i)}.png`,
          label: `Image ${String(i)}`,
          expectedKind: 'spec',
        })),
      });

    it('renders a short "ground truth: <manifest basename>" label, not the raw JSON', () => {
      expect(formatReviewMode(bigMode, null)).toBe('ground truth: manifest.json');
    });

    it('never leaks the serialized comparisons payload into the label (GB-971 regression)', () => {
      const out = formatReviewMode(bigMode, null);
      // The label must be short and free of the payload's tell-tale tokens.
      expect(out.length).toBeLessThan(60);
      expect(out).not.toContain('comparisons');
      expect(out).not.toContain('expectedPath');
      expect(out).not.toContain('{');
    });

    it('prefers a non-empty mode_args label when present', () => {
      expect(formatReviewMode(bigMode, 'manifest.json')).toBe('ground truth: manifest.json');
    });

    it('falls back to a bare label on malformed JSON', () => {
      expect(formatReviewMode('ground-truth:garbage', null)).toBe('ground truth');
    });

    it('falls back to a bare label when manifestPath is missing', () => {
      expect(formatReviewMode('ground-truth:{"comparisons":[]}', null)).toBe('ground truth');
    });
  });

  describe('unknown mode', () => {
    it('passes through an unrecognized mode unchanged', () => {
      expect(formatReviewMode('weird-mode', null)).toBe('weird-mode');
    });
  });
});
