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
    expect(section).toContain('[Risk, L2] flagged risk');
  });

  it('returns empty string when no file has notes', () => {
    expect(reviewNotesPromptSection(repo, ['src/other.ts'])).toBe('');
  });
});

describe('reviewNotesExportSection', () => {
  it('emits a markdown section with per-file notes and producer attribution', () => {
    const md = reviewNotesExportSection(repo, ['src/x.ts']).join('\n');
    expect(md).toContain('## AI Review Notes');
    expect(md).toContain('### src/x.ts');
    expect(md).toContain('**Line 2** [risk]: flagged risk _(Claude Code)_');
  });

  it('returns [] when no file has notes', () => {
    expect(reviewNotesExportSection(repo, ['src/other.ts'])).toEqual([]);
  });
});
