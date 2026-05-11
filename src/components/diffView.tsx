import type { SafeHtml } from 'kerfjs';

import type { Annotation,ReviewFile } from '../db/queries.js';
import type { DiffHunk, DiffLine,FileDiff } from '../git/diff.js';
import { isImageFile, isSvgFile } from '../git/image.js';
import { IconEdit, IconReveal, IconTrash } from '../icons.js';
import { charDiff, type DiffSegment } from '../utils/charDiff.js';
import { ImageDiff } from './imageDiff.js';

export function DiffView({ file, diff, annotations, mode }: {
  file: ReviewFile;
  diff: FileDiff;
  annotations: Annotation[];
  mode: 'split' | 'unified';
}) {
  const annotationsByLine: Record<string, Annotation[]> = {};
  for (const a of annotations) {
    const key = `${a.line_number}:${a.side}`;
    if (!(key in annotationsByLine)) annotationsByLine[key] = [];
    annotationsByLine[key].push(a);
  }

  return (
    <div className="diff-view" data-file-id={file.id} data-file-path={file.file_path}
      {...(isSvgFile(diff.filePath) ? { 'data-is-svg': 'true' } : {})}>
      <div className="diff-header">
        <div className="diff-header-file">
          <span className="file-path">{diff.filePath}</span>
          <button className="reveal-btn" data-file-id={file.id} title="Reveal in file manager"><IconReveal /></button>
        </div>
        <div className="diff-header-actions">
          <span className={`file-status ${diff.status}`}>{diff.status}</span>
        </div>
      </div>
      {diff.isBinary && isImageFile(diff.filePath) ? (
        <ImageDiff file={file} diff={diff} />
      ) : diff.isBinary ? (
        <div className="hunk-separator">Binary file</div>
      ) : (diff.status === 'added' || diff.status === 'deleted' || mode === 'unified') ? (
        <UnifiedDiff hunks={diff.hunks} annotationsByLine={annotationsByLine} />
      ) : (
        <SplitDiff hunks={diff.hunks} annotationsByLine={annotationsByLine} />
      )}
    </div>
  );
}

// A single item in the flattened split diff stream
type SplitItem =
  | { kind: 'separator'; hunkIdx: number; hunk: DiffHunk; gapStart: number; gapEnd: number }
  | { kind: 'pair'; pair: LinePair }
  | { kind: 'annotated'; pair: LinePair; annotations: Annotation[] }
  | { kind: 'tail'; start: number };

function getAnnotations(pair: LinePair, annotationsByLine: Record<string, Annotation[]>): Annotation[] {
  const leftAnns = pair.left ? annotationsByLine[`${pair.left.oldNum}:old`] ?? [] : [];
  const rightAnns = pair.right ? annotationsByLine[`${pair.right.newNum}:new`] ?? [] : [];
  return [...leftAnns, ...rightAnns];
}

function SplitDiff({ hunks, annotationsByLine }: { hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]> }) {
  const lastHunk = hunks[hunks.length - 1] as DiffHunk | undefined;
  const tailStart = lastHunk ? lastHunk.newStart + lastHunk.newCount : 1;

  // Flatten all hunks into a single stream of items
  const items: SplitItem[] = [];
  for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
    const hunk = hunks[hunkIdx];
    const prevHunk = hunkIdx > 0 ? hunks[hunkIdx - 1] : null;
    const gapStart = prevHunk ? prevHunk.newStart + prevHunk.newCount : 1;
    const gapEnd = hunk.newStart - 1;
    items.push({ kind: 'separator', hunkIdx, hunk, gapStart, gapEnd });

    for (const pair of pairLines(hunk.lines)) {
      const anns = getAnnotations(pair, annotationsByLine);
      if (anns.length > 0) {
        items.push({ kind: 'annotated', pair, annotations: anns });
      } else {
        items.push({ kind: 'pair', pair });
      }
    }
  }
  items.push({ kind: 'tail', start: tailStart });

  // Group consecutive non-annotated items into split-columns blocks.
  // Annotated pairs break the flow so annotations render full-width.
  type Group =
    | { type: 'columns'; items: Exclude<SplitItem, { kind: 'annotated' }>[] }
    | { type: 'annotated'; pair: LinePair; annotations: Annotation[] };

  const groups: Group[] = [];
  let run: Exclude<SplitItem, { kind: 'annotated' }>[] = [];

  for (const item of items) {
    if (item.kind === 'annotated') {
      if (run.length > 0) { groups.push({ type: 'columns', items: run }); run = []; }
      groups.push({ type: 'annotated', pair: item.pair, annotations: item.annotations });
    } else {
      run.push(item);
    }
  }
  if (run.length > 0) groups.push({ type: 'columns', items: run });

  return (
    <div className="diff-table-split">
      {groups.map(group => {
        if (group.type === 'annotated') {
          return (
            <div>
              <div className="split-row">
                <div className={`diff-line split-left ${group.pair.left?.type || 'empty'}`}
                  data-line={group.pair.left?.oldNum ?? ''} data-side="old"
                  data-new-line={group.pair.left?.newNum ?? group.pair.right?.newNum ?? ''}>
                  <span className="gutter" data-line-number={group.pair.left?.oldNum ?? ''}></span>
                  <span className="code">{renderPairContent(group.pair, 'left')}</span>
                </div>
                <div className={`diff-line split-right ${group.pair.right?.type || 'empty'}`}
                  data-line={group.pair.right?.newNum ?? ''} data-side="new">
                  <span className="gutter" data-line-number={group.pair.right?.newNum ?? ''}></span>
                  <span className="code">{renderPairContent(group.pair, 'right')}</span>
                </div>
              </div>
              <AnnotationRows annotations={group.annotations} />
            </div>
          );
        }

        // Render as two continuous independent columns
        return (
          <div className="split-columns">
            <div className="split-col split-col-left">
              {group.items.map(item => {
                if (item.kind === 'separator') {
                  const { hunk, hunkIdx, gapStart, gapEnd } = item;
                  return (
                    <div className="hunk-separator" data-hunk-idx={hunkIdx}
                      data-old-start={hunk.oldStart} data-old-count={hunk.oldCount}
                      data-new-start={hunk.newStart} data-new-count={hunk.newCount}
                      data-gap-start={gapStart} data-gap-end={gapEnd}>
                      @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                    </div>
                  );
                }
                if (item.kind === 'tail') {
                  return (
                    <div className="hunk-separator hunk-expander-tail" data-start={item.start}>
                      ↕ Show remaining lines
                    </div>
                  );
                }
                const { pair } = item;
                return (
                  <div className={`diff-line split-left ${pair.left?.type || 'empty'}`}
                    data-line={pair.left?.oldNum ?? ''} data-side="old"
                    data-new-line={pair.left?.newNum ?? pair.right?.newNum ?? ''}>
                    <span className="gutter" data-line-number={pair.left?.oldNum ?? ''}></span>
                    <span className="code">{renderPairContent(pair, 'left')}</span>
                  </div>
                );
              })}
            </div>
            <div className="split-col split-col-right">
              {group.items.map(item => {
                if (item.kind === 'separator') {
                  const { hunk, hunkIdx, gapStart, gapEnd } = item;
                  return (
                    <div className="hunk-separator" data-hunk-idx={hunkIdx}
                      data-old-start={hunk.oldStart} data-old-count={hunk.oldCount}
                      data-new-start={hunk.newStart} data-new-count={hunk.newCount}
                      data-gap-start={gapStart} data-gap-end={gapEnd}>
                      @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                    </div>
                  );
                }
                if (item.kind === 'tail') {
                  return (
                    <div className="hunk-separator hunk-expander-tail" data-start={item.start}>
                      ↕ Show remaining lines
                    </div>
                  );
                }
                const { pair } = item;
                return (
                  <div className={`diff-line split-right ${pair.right?.type || 'empty'}`}
                    data-line={pair.right?.newNum ?? ''} data-side="new">
                    <span className="gutter" data-line-number={pair.right?.newNum ?? ''}></span>
                    <span className="code">{renderPairContent(pair, 'right')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Render content with optional character-level diff highlighting. */
function renderSegments(segments: DiffSegment[]): SafeHtml {
  return <>{segments.map(s => s.changed ? <span className="char-change">{s.text}</span> : <>{s.text}</>)}</>;
}

/** Get character-highlighted content for a paired remove+add line, or plain content. */
function renderPairContent(pair: LinePair, side: 'left' | 'right'): SafeHtml | string {
  const line = side === 'left' ? pair.left : pair.right;
  if (!line) return '';
  // Only compute char diff for paired remove+add lines
  if (pair.left && pair.right && pair.left.type === 'remove' && pair.right.type === 'add') {
    const diff = charDiff(pair.left.content, pair.right.content);
    if (diff) {
      return renderSegments(side === 'left' ? diff.oldSegments : diff.newSegments);
    }
  }
  return line.content;
}

interface LinePair {
  left: DiffLine | null;
  right: DiffLine | null;
}

function pairLines(lines: DiffLine[]): LinePair[] {
  const pairs: LinePair[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'context') {
      pairs.push({ left: line, right: line });
      i++;
    } else if (line.type === 'remove') {
      // Collect consecutive removes, then pair with consecutive adds
      const removes: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'remove') {
        removes.push(lines[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'add') {
        adds.push(lines[i]);
        i++;
      }
      const max = Math.max(removes.length, adds.length);
      for (let j = 0; j < max; j++) {
        pairs.push({
          left: j < removes.length ? removes[j] : null,
          right: j < adds.length ? adds[j] : null,
        });
      }
    } else {
      pairs.push({ left: null, right: line });
      i++;
    }
  }
  return pairs;
}

/** Pre-compute char diffs for paired remove/add lines in a hunk for unified view. */
function buildUnifiedCharDiffs(lines: DiffLine[]): Map<DiffLine, DiffSegment[]> {
  const result = new Map<DiffLine, DiffSegment[]>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === 'remove') {
      const removes: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'remove') { removes.push(lines[i]); i++; }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'add') { adds.push(lines[i]); i++; }
      const pairCount = Math.min(removes.length, adds.length);
      for (let j = 0; j < pairCount; j++) {
        const diff = charDiff(removes[j].content, adds[j].content);
        if (diff) {
          result.set(removes[j], diff.oldSegments);
          result.set(adds[j], diff.newSegments);
        }
      }
    } else {
      i++;
    }
  }
  return result;
}

function UnifiedDiff({ hunks, annotationsByLine }: { hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]> }) {
  const lastHunk = hunks[hunks.length - 1] as DiffHunk | undefined;
  const tailStart = lastHunk ? lastHunk.newStart + lastHunk.newCount : 1;

  return (
    <div className="diff-table-unified">
      {hunks.map((hunk, hunkIdx) => {
        const charDiffs = buildUnifiedCharDiffs(hunk.lines);
        return (
        <div className="hunk-block">
          <div className="hunk-separator" data-hunk-idx={hunkIdx}
            data-old-start={hunk.oldStart} data-old-count={hunk.oldCount}
            data-new-start={hunk.newStart} data-new-count={hunk.newCount}>
            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
          </div>
          {hunk.lines.map(line => {
            const lineNum = line.type === 'remove' ? line.oldNum : line.newNum;
            const side = line.type === 'remove' ? 'old' : 'new';
            const anns = annotationsByLine[`${lineNum}:${side}`] ?? [];
            const segments = charDiffs.get(line);
            return (
              <div>
                <div
                  className={`diff-line ${line.type}${anns.length ? ' has-annotation' : ''}`}
                  data-line={lineNum}
                  data-side={side}
                >
                  <span className="gutter-old" data-line-number={line.oldNum ?? ''}></span>
                  <span className="gutter-new" data-line-number={line.newNum ?? ''}></span>
                  <span className="code">{segments ? renderSegments(segments) : line.content}</span>
                </div>
                {anns.length > 0 ? <AnnotationRows annotations={anns} /> : null}
              </div>
            );
          })}
        </div>
        );
      })}
      <div className="hunk-separator hunk-expander-tail" data-start={tailStart}>
        ↕ Show remaining lines
      </div>
    </div>
  );
}

function AnnotationRows({ annotations }: { annotations: Annotation[] }) {
  return (
    <div className="annotation-row">
      {annotations.map(a => (
        <div className={`annotation-item${a.is_stale ? ' annotation-stale' : ''}`}
          data-annotation-id={a.id} data-is-stale={a.is_stale ? 'true' : undefined}>
          <span className="annotation-drag-handle" draggable={true} title="Drag to move">⠿</span>
          <span className={`annotation-category category-${a.category}`} data-action="reclassify">{a.category}</span>
          <span className="annotation-text">{a.content}</span>
          <div className="annotation-actions">
            {a.is_stale ? <button className="btn btn-xs btn-keep" data-action="keep">Keep</button> : null}
            <button className="btn btn-xs btn-icon" data-action="edit" title="Edit"><IconEdit /></button>
            <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete"><IconTrash /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
