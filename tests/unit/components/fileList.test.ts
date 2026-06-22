import { FileList } from '../../../src/components/fileList.js';
import type { ReviewFile } from '../../../src/db/queries.js';

function makeFile(path: string, overrides: Partial<ReviewFile> = {}): ReviewFile {
  return {
    id: `f-${path}`, review_id: 'r1', file_path: path,
    status: 'pending', diff_data: JSON.stringify({ status: 'modified' }),
    ...overrides,
  };
}

describe('FileList', () => {
  it('renders file list container', () => {
    const html = FileList({ files: [], annotationCounts: {}, staleCounts: {} }).toString();
    expect(html).toContain('file-list');
    expect(html).toContain('file-list-items');
  });

  it('renders files with names and status', () => {
    const files = [makeFile('src/app.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    expect(html).toContain('app.ts');
    expect(html).toContain('file-item');
    expect(html).toContain('file-status modified');
  });

  it('groups files into folder tree', () => {
    const files = [makeFile('src/a.ts'), makeFile('src/b.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    expect(html).toContain('folder-header');
    expect(html).toContain('src/');
  });

  it('compresses single-child directories', () => {
    const files = [makeFile('src/utils/helpers/deep.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    // Should compress src/utils/helpers into one node
    expect(html).toContain('src/utils/helpers/');
  });

  it('shows annotation counts', () => {
    const files = [makeFile('a.ts')];
    const html = FileList({ files, annotationCounts: { 'f-a.ts': 3 }, staleCounts: {} }).toString();
    expect(html).toContain('annotation-count');
    expect(html).toContain('>3<');
  });

  it('does not show annotation count when zero', () => {
    const files = [makeFile('a.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    expect(html).not.toContain('annotation-count');
  });

  it('shows stale dot on files with stale annotations', () => {
    const files = [makeFile('a.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: { 'f-a.ts': 2 } }).toString();
    expect(html).toContain('stale-dot');
  });

  it('shows stale dot on folder containing stale file', () => {
    const files = [makeFile('src/a.ts'), makeFile('src/b.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: { 'f-src/a.ts': 1 } }).toString();
    // Both the folder header and the file should have stale dots
    const matches = html.match(/stale-dot/g);
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('marks collapsible folders with more than one file', () => {
    const files = [makeFile('src/a.ts'), makeFile('src/b.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    expect(html).toContain('collapsible');
    expect(html).toContain('folder-arrow');
    // GB-952: the disclosure caret is a lucide chevron (<svg>), not the ▾ glyph.
    expect(html).not.toContain('▾');
  });

  it('renders file status from diff_data', () => {
    const files = [makeFile('a.ts', { diff_data: JSON.stringify({ status: 'added' }) })];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    expect(html).toContain('file-status added');
  });

  it('renders file-item data attributes', () => {
    const files = [makeFile('src/app.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    expect(html).toContain('data-file-id="f-src/app.ts"');
  });

  it('sorts folder children alphabetically', () => {
    const files = [makeFile('z/a.ts'), makeFile('a/b.ts')];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    const aIdx = html.indexOf('a/');
    const zIdx = html.indexOf('z/');
    expect(aIdx).toBeLessThan(zIdx);
  });

  it('renders status dot with file status class', () => {
    const files = [makeFile('a.ts', { status: 'reviewed' })];
    const html = FileList({ files, annotationCounts: {}, staleCounts: {} }).toString();
    expect(html).toContain('status-dot reviewed');
  });
});
