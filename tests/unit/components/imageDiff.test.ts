import { ImageDiff } from '../../../src/components/imageDiff.js';
import type { ReviewFile } from '../../../src/db/queries.js';
import type { FileDiff } from '../../../src/git/diff.js';

function makeFile(overrides: Partial<ReviewFile> = {}): ReviewFile {
  return {
    id: 'f1', review_id: 'r1', file_path: 'logo.png',
    status: 'pending', diff_data: null, ...overrides,
  };
}

function makeDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    filePath: 'logo.png', oldPath: null, status: 'modified',
    isBinary: true, hunks: [], ...overrides,
  };
}

describe('ImageDiff', () => {
  it('renders container with file data attributes', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).toContain('image-diff');
    expect(html).toContain('data-file-id="f1"');
    expect(html).toContain('data-file-path="logo.png"');
  });

  it('sets data-has-old and data-has-new for modified files', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).toContain('data-has-old="true"');
    expect(html).toContain('data-has-new="true"');
  });

  it('renders difference and slice panels for modified files', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).toContain('data-panel="difference"');
    expect(html).toContain('data-panel="slice"');
    expect(html).toContain('data-panel="metadata"');
  });

  it('renders single-side A and B focus panels for modified files (doc 28)', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).toContain('data-panel="a"');
    expect(html).toContain('data-panel="b"');
    // A focuses the old image, B the new — each scoped overlay matches its side.
    expect(html).toContain('data-region-side="old"');
    expect(html).toContain('data-region-side="new"');
  });

  it('renders only image panel for added files', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff({ status: 'added' }) }).toString();
    expect(html).toContain('data-has-old="false"');
    expect(html).toContain('data-has-new="true"');
    expect(html).toContain('data-panel="image"');
    expect(html).not.toContain('data-panel="difference"');
    expect(html).not.toContain('data-panel="slice"');
    // The A/B focus panels are comparison-only, like difference/slice.
    expect(html).not.toContain('data-panel="a"');
    expect(html).not.toContain('data-panel="b"');
  });

  it('renders only image panel for deleted files', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff({ status: 'deleted' }) }).toString();
    expect(html).toContain('data-has-old="true"');
    expect(html).toContain('data-has-new="false"');
    expect(html).toContain('data-panel="image"');
    expect(html).not.toContain('data-panel="a"');
    expect(html).not.toContain('data-panel="b"');
  });

  it('renders image sources with correct API paths', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).toContain('src="/api/image/f1/old"');
    expect(html).toContain('src="/api/image/f1/new"');
  });

  it('renders font warning when fontWarning is true', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff(), fontWarning: true }).toString();
    expect(html).toContain('image-font-warning');
    expect(html).toContain('locally installed fonts');
  });

  it('does not render font warning by default', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).not.toContain('image-font-warning');
  });

  it('includes base dimensions when provided', () => {
    const html = ImageDiff({
      file: makeFile(), diff: makeDiff(), baseWidth: 800, baseHeight: 600,
    }).toString();
    expect(html).toContain('data-base-width="800"');
    expect(html).toContain('data-base-height="600"');
  });

  it('omits base dimensions when not provided', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).not.toContain('data-base-width');
    expect(html).not.toContain('data-base-height');
  });

  it('renders metadata panel with loading message', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).toContain('Loading metadata');
  });

  it('renders slice handle elements for modified files', () => {
    const html = ImageDiff({ file: makeFile(), diff: makeDiff() }).toString();
    expect(html).toContain('slice-line');
    expect(html).toContain('slice-handle-a');
    expect(html).toContain('slice-handle-b');
  });
});
