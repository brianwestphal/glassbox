/**
 * GB-899 (P5) — folding review notes into the analysis prompt and the export.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reviewNotesExportSection, reviewNotesPromptSection } from '../../../src/review-notes/format.js';
import { writeReviewNote } from '../../../src/review-notes/store.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'glassbox-notesfmt-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/x.ts'), 'a\nb\nc\nd\ne\n', 'utf-8');
  writeReviewNote(repo, { file: 'src/x.ts', startLine: 2, endLine: 2, body: 'flagged risk', kind: 'risk', producer: 'Claude Code' });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('reviewNotesPromptSection', () => {
  it('formats the author notes for the analysis prompt', () => {
    const section = reviewNotesPromptSection(repo, ['src/x.ts']);
    expect(section).toContain('Author review notes');
    expect(section).toContain('src/x.ts:');
    expect(section).toContain('[Risk, L2]: flagged risk');
  });

  it('returns empty string when no file has notes', () => {
    expect(reviewNotesPromptSection(repo, ['src/other.ts'])).toBe('');
  });

  it('indents a multi-line body beneath its label instead of orphaning it at column 0 (GB-1095)', () => {
    writeReviewNote(repo, { file: 'src/x.ts', startLine: 4, endLine: 4, body: '### Why\n\n- first\n- second', kind: 'rationale' });
    const lines = reviewNotesPromptSection(repo, ['src/x.ts']).split('\n');

    expect(lines).toContain('- [Rationale, L4]');
    // Every body line stays indented into the item — none flush at column 0.
    for (const body of ['### Why', '- first', '- second']) {
      expect(lines).toContain(`  ${body}`);
      expect(lines).not.toContain(body);
    }
  });
});

describe('reviewNotesExportSection', () => {
  it('emits a markdown section with per-file notes and producer attribution', () => {
    const md = reviewNotesExportSection(repo, ['src/x.ts']).join('\n');
    expect(md).toContain('## AI Review Notes');
    expect(md).toContain('### src/x.ts');
    expect(md).toContain('**Line 2** [risk] _(Claude Code)_: flagged risk');
  });

  it('returns [] when no file has notes', () => {
    expect(reviewNotesExportSection(repo, ['src/other.ts'])).toEqual([]);
  });

  /**
   * A body is markdown and may span lines. Folded naively into a `- ` bullet,
   * its second and later lines land at column 0 — which ends the list — and its
   * headings escape into the export's own `##`/`###` hierarchy (GB-1095).
   */
  describe('multi-line bodies', () => {
    const BODY = [
      '### Root cause',
      '',
      'The guard was missing.',
      '',
      '- first',
      '- second',
      '',
      '```sh',
      '# not a heading',
      'npm test',
      '```',
    ].join('\n');

    function exportLines(): string[] {
      writeReviewNote(repo, { file: 'src/x.ts', startLine: 4, endLine: 4, body: BODY, kind: 'proof', producer: 'Hot Sheet' });
      return reviewNotesExportSection(repo, ['src/x.ts']);
    }

    it('keeps every body line inside the list item', () => {
      const lines = exportLines();
      expect(lines).toContain('- **Line 4** [proof] _(Hot Sheet)_');
      // Non-blank body lines are indented to the item's content column; nothing
      // is left flush at column 0 where it would terminate the list.
      for (const body of ['The guard was missing.', '- first', '- second', '```sh', 'npm test']) {
        expect(lines).toContain(`  ${body}`);
      }
      // Blank separators stay genuinely blank rather than indent-only noise.
      expect(lines.some(l => /^\s+$/.test(l))).toBe(false);
    });

    it('demotes body headings below the export\'s own file heading', () => {
      const lines = exportLines();
      expect(lines).toContain('  #### Root cause');
      expect(lines).not.toContain('  ### Root cause');
      // The `### <file>` heading itself is untouched.
      expect(lines).toContain('### src/x.ts');
    });

    it('leaves a `#` line inside a fenced block alone', () => {
      expect(exportLines()).toContain('  # not a heading');
    });

    it('preserves relative heading depth when demoting', () => {
      writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: '## Top\n\n#### Deep\n\nbody', kind: 'rationale' });
      const lines = reviewNotesExportSection(repo, ['src/x.ts']);
      // Shallowest (h2) → h4, so the h4 two levels below it lands at h6.
      expect(lines).toContain('  #### Top');
      expect(lines).toContain('  ###### Deep');
    });

    it('caps demotion at h6 rather than emitting seven hashes', () => {
      writeReviewNote(repo, { file: 'src/x.ts', startLine: 1, endLine: 1, body: '##### Deep\n\n###### Deeper\n\nbody', kind: 'rationale' });
      const lines = reviewNotesExportSection(repo, ['src/x.ts']);
      expect(lines.some(l => l.includes('#######'))).toBe(false);
      expect(lines).toContain('  ###### Deeper');
    });

    it('leaves a single-line body inline, unchanged', () => {
      const md = reviewNotesExportSection(repo, ['src/x.ts']).join('\n');
      expect(md).toContain('**Line 2** [risk] _(Claude Code)_: flagged risk');
    });
  });
});
