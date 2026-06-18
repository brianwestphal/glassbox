import { DiffView } from '../../../src/components/diffView.js';
import type { Annotation, ReviewFile } from '../../../src/db/queries.js';
import type { DiffHunk, DiffLine, FileDiff } from '../../../src/git/diff.js';

function makeFile(overrides: Partial<ReviewFile> = {}): ReviewFile {
  return {
    id: 'f1', review_id: 'r1', file_path: 'src/app.ts',
    status: 'pending', diff_data: null, ...overrides,
  };
}

function makeDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    filePath: 'src/app.ts', oldPath: null, status: 'modified',
    isBinary: false, hunks: [], ...overrides,
  };
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1', review_file_id: 'f1', line_number: 1, side: 'new',
    category: 'bug', content: 'Fix this', is_stale: false,
    original_content: null, reply_to_note_id: null, created_at: '', updated_at: '', ...overrides,
  };
}

function makeLine(type: DiffLine['type'], lineNum: number, content = 'code'): DiffLine {
  return {
    type,
    oldNum: type === 'add' ? null : lineNum,
    newNum: type === 'remove' ? null : lineNum,
    content,
  };
}

function makeHunk(lines: DiffLine[], start = 1): DiffHunk {
  return {
    oldStart: start, oldCount: lines.filter(l => l.type !== 'add').length,
    newStart: start, newCount: lines.filter(l => l.type !== 'remove').length,
    lines,
  };
}

describe('DiffView', () => {
  it('renders diff header with file path and status', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff(), annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('src/app.ts');
    expect(html).toContain('file-status modified');
    expect(html).toContain('diff-view');
    expect(html).toContain('data-file-path="src/app.ts"');
  });

  it('renders no review-note rows when there are no notes (GB-896)', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1)])] }),
      annotations: [], mode: 'unified',
    }).toString();
    expect(html).not.toContain('ai-note-review');
  });

  it('renders a review note as a full-width AI-authored row anchored to its line — unified (GB-896)', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1, 'const x = 1;')])] }),
      annotations: [], mode: 'unified',
      reviewNotes: [{ line: 1, side: 'new', kind: 'risk', body: 'careful here', producer: 'Claude Code' }],
    }).toString();
    expect(html).toContain('ai-note-row ai-note-review');
    expect(html).toContain('ai-note-label-risk');
    expect(html).toContain('careful here');
    expect(html).toContain('Claude Code');
  });

  it('breaks the split flow to render a review note full-width — split (GB-896)', () => {
    // A modified hunk: a removed line paired with an added new-side line 1.
    const hunk = makeHunk([makeLine('remove', 1, 'old'), makeLine('add', 1, 'new')]);
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [hunk] }),
      annotations: [], mode: 'split',
      reviewNotes: [{ line: 1, side: 'new', kind: 'proof', body: 'why it holds' }],
    }).toString();
    expect(html).toContain('ai-note-row ai-note-review');
    expect(html).toContain('why it holds');
  });

  it('renders a Reply button and data-note-id on a review note with a guid (GB-906)', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1, 'code')])] }),
      annotations: [], mode: 'unified',
      reviewNotes: [{ guid: 'note-abc', line: 1, side: 'new', kind: 'rationale', body: 'why' }],
    }).toString();
    expect(html).toContain('data-note-id="note-abc"');
    expect(html).toContain('ai-note-reply-btn');
  });

  it('marks a human annotation as a reply when it links to a note (GB-906)', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1, 'code')])] }),
      annotations: [makeAnnotation({ line_number: 1, reply_to_note_id: 'note-abc', content: 'I disagree' })],
      mode: 'unified',
      reviewNotes: [{ guid: 'note-abc', line: 1, side: 'new', kind: 'rationale', body: 'why' }],
    }).toString();
    expect(html).toContain('annotation-reply-tag');
    expect(html).toContain('I disagree');
  });

  it('nests a reply beneath its note (GB-908)', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1, 'code')])] }),
      annotations: [makeAnnotation({ id: 'r1', line_number: 1, reply_to_note_id: 'note-abc', content: 'a reply' })],
      mode: 'unified',
      reviewNotes: [{ guid: 'note-abc', line: 1, side: 'new', kind: 'rationale', body: 'why' }],
    }).toString();
    // The reply lives in the nested replies block, not a top-level annotation-row.
    expect(html).toContain('ai-note-replies');
    // The note row comes before the reply.
    expect(html.indexOf('data-note-id="note-abc"')).toBeLessThan(html.indexOf('a reply'));
  });

  it('falls back to line rendering for an orphan reply whose note is not loaded (GB-908)', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1, 'code')])] }),
      annotations: [makeAnnotation({ line_number: 1, reply_to_note_id: 'missing-note', content: 'orphan reply' })],
      mode: 'unified',
    }).toString();
    expect(html).not.toContain('ai-note-replies');
    expect(html).toContain('orphan reply'); // still rendered, just on its line
  });

  it('marks a stale review note as outdated (GB-897)', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1, 'code')])] }),
      annotations: [], mode: 'unified',
      reviewNotes: [{ line: 1, side: 'new', kind: 'risk', body: 'no longer applies', stale: true }],
    }).toString();
    expect(html).toContain('ai-note-stale');
    expect(html).toContain('outdated');
  });

  it('offers Keep/Discard only on a stale note that has a guid (GB-907)', () => {
    const stale = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1, 'code')])] }),
      annotations: [], mode: 'unified',
      reviewNotes: [{ guid: 'g1', line: 1, side: 'new', kind: 'risk', body: 'old', stale: true }],
    }).toString();
    expect(stale).toContain('ai-note-keep-btn');
    expect(stale).toContain('ai-note-discard-btn');

    const fresh = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1, 'code')])] }),
      annotations: [], mode: 'unified',
      reviewNotes: [{ guid: 'g1', line: 1, side: 'new', kind: 'risk', body: 'current' }],
    }).toString();
    expect(fresh).not.toContain('ai-note-keep-btn');
  });

  it('escapes a note body so markup cannot break rendering (GB-896)', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ hunks: [makeHunk([makeLine('add', 1)])] }),
      annotations: [], mode: 'unified',
      reviewNotes: [{ line: 1, side: 'new', kind: 'proof', body: '<b>x</b>' }],
    }).toString();
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('renders binary file message for non-image binary', () => {
    const html = DiffView({
      file: makeFile(), diff: makeDiff({ isBinary: true, filePath: 'data.bin' }),
      annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('Binary file');
  });

  it('renders ImageDiff for binary image files', () => {
    const html = DiffView({
      file: makeFile({ file_path: 'logo.png' }),
      diff: makeDiff({ isBinary: true, filePath: 'logo.png' }),
      annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('image-diff');
  });

  it('renders unified mode for added files', () => {
    const lines = [makeLine('add', 1, 'new line')];
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ status: 'added', hunks: [makeHunk(lines)] }),
      annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('diff-table-unified');
  });

  it('renders unified mode for deleted files', () => {
    const lines = [makeLine('remove', 1, 'old line')];
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ status: 'deleted', hunks: [makeHunk(lines)] }),
      annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('diff-table-unified');
  });

  it('renders split mode for modified files', () => {
    const lines = [
      makeLine('remove', 1, 'old'),
      makeLine('add', 1, 'new'),
    ];
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ hunks: [makeHunk(lines)] }),
      annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('diff-table-split');
  });

  it('renders unified mode when mode is unified', () => {
    const lines = [makeLine('context', 1, 'same')];
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ hunks: [makeHunk(lines)] }),
      annotations: [], mode: 'unified',
    }).toString();
    expect(html).toContain('diff-table-unified');
  });

  it('renders hunk separator with line info', () => {
    const lines = [makeLine('context', 5, 'code')];
    const hunk = makeHunk(lines, 5);
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ hunks: [hunk] }),
      annotations: [], mode: 'unified',
    }).toString();
    expect(html).toContain('hunk-separator');
    expect(html).toContain(`data-old-start="${hunk.oldStart}"`);
  });

  it('renders annotation rows for annotated lines', () => {
    const lines = [makeLine('add', 3, 'buggy code')];
    const ann = makeAnnotation({ line_number: 3, side: 'new' });
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ status: 'added', hunks: [makeHunk(lines, 3)] }),
      annotations: [ann], mode: 'unified',
    }).toString();
    expect(html).toContain('annotation-row');
    expect(html).toContain('Fix this');
    expect(html).toContain('category-bug');
  });

  it('renders stale annotation with keep button', () => {
    const lines = [makeLine('add', 1, 'code')];
    const ann = makeAnnotation({ line_number: 1, side: 'new', is_stale: true });
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ status: 'added', hunks: [makeHunk(lines)] }),
      annotations: [ann], mode: 'unified',
    }).toString();
    expect(html).toContain('annotation-stale');
    expect(html).toContain('btn-keep');
  });

  it('renders split diff with context lines on both sides', () => {
    const lines = [makeLine('context', 1, 'unchanged')];
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ hunks: [makeHunk(lines)] }),
      annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('split-col-left');
    expect(html).toContain('split-col-right');
  });

  it('renders annotations in split mode breaking column flow', () => {
    const lines = [makeLine('add', 1, 'new code')];
    const ann = makeAnnotation({ line_number: 1, side: 'new' });
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ hunks: [makeHunk(lines)] }),
      annotations: [ann], mode: 'split',
    }).toString();
    expect(html).toContain('split-row');
    expect(html).toContain('annotation-row');
  });

  it('renders tail expander after last hunk', () => {
    const lines = [makeLine('context', 1, 'code')];
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ hunks: [makeHunk(lines)] }),
      annotations: [], mode: 'unified',
    }).toString();
    expect(html).toContain('hunk-expander-tail');
    expect(html).toContain('Show remaining lines');
  });

  it('renders character-level diff for paired remove+add lines', () => {
    const lines = [
      makeLine('remove', 1, 'hello world'),
      makeLine('add', 1, 'hello earth'),
    ];
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ hunks: [makeHunk(lines)] }),
      annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('char-change');
  });

  it('adds data-is-svg for SVG files', () => {
    const html = DiffView({
      file: makeFile({ file_path: 'icon.svg' }),
      diff: makeDiff({ filePath: 'icon.svg' }),
      annotations: [], mode: 'split',
    }).toString();
    expect(html).toContain('data-is-svg="true"');
  });

  // Source maps and minified bundles can produce paired remove/add lines
  // 100 KB+ each. charDiff used to build an O(m*n) LCS table over those,
  // which OOM'd the server and bounced the browser back to the welcome
  // screen as if the file selection had failed. GB-821 then showed that even
  // the plain (un-char-diffed) giant line froze the browser when it was put
  // into the DOM in full, so such lines are now truncated for display.
  it('truncates huge paired remove/add lines instead of rendering them in full', () => {
    const huge = 'a'.repeat(120_000);
    const huger = 'a'.repeat(120_000).replace('aaaa', 'bbbb');
    const lines = [
      makeLine('remove', 1, huge),
      makeLine('add', 1, huger),
    ];
    const start = Date.now();
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ status: 'modified', hunks: [makeHunk(lines)] }),
      annotations: [], mode: 'split',
    }).toString();
    // Rendering must stay well under the per-test memory + time budget;
    // the pre-fix version exhausted a 4 GB heap before returning.
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(html).toContain('diff-view');
    // The giant line is truncated: the full content never reaches the DOM, so
    // the rendered HTML is far smaller than the input and carries the marker.
    expect(html.length).toBeLessThan(huge.length);
    expect(html).toContain('line-truncated');
    expect(html).toContain('more characters hidden');
  });

  it('renders drag handle and action buttons on annotations', () => {
    const lines = [makeLine('add', 1, 'code')];
    const ann = makeAnnotation({ line_number: 1, side: 'new' });
    const html = DiffView({
      file: makeFile(),
      diff: makeDiff({ status: 'added', hunks: [makeHunk(lines)] }),
      annotations: [ann], mode: 'unified',
    }).toString();
    expect(html).toContain('annotation-drag-handle');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('data-action="delete"');
    expect(html).toContain('data-action="reclassify"');
  });
});
