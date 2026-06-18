import type { SafeHtml } from 'kerfjs';

import type { Annotation,ReviewFile } from '../db/queries.js';
import type { DiffHunk, DiffLine,FileDiff } from '../git/diff.js';
import { isImageFile, isSvgFile } from '../git/image.js';
import { IconEdit, IconReveal, IconTrash } from '../icons.js';
import type { ReviewNoteView } from '../review-notes/view.js';
import { REVIEW_NOTE_LABELS } from '../review-notes/view.js';
import { charDiff, type DiffSegment } from '../utils/charDiff.js';
import { truncateDiffLine } from '../utils/lineTruncate.js';
import { ImageDiff } from './imageDiff.js';

export function DiffView({ file, diff, annotations, mode, reviewNotes = [] }: {
  file: ReviewFile;
  diff: FileDiff;
  annotations: Annotation[];
  mode: 'split' | 'unified';
  reviewNotes?: ReviewNoteView[];
}) {
  const annotationsByLine: Record<string, Annotation[]> = {};
  for (const a of annotations) {
    const key = `${a.line_number}:${a.side}`;
    if (!(key in annotationsByLine)) annotationsByLine[key] = [];
    annotationsByLine[key].push(a);
  }
  // AI-authored review notes anchor to the new side; key them the same way so
  // they can break the diff flow at their line (full-width, like annotations).
  const reviewNotesByLine: Record<string, ReviewNoteView[]> = {};
  for (const n of reviewNotes) {
    const key = `${n.line}:${n.side}`;
    if (!(key in reviewNotesByLine)) reviewNotesByLine[key] = [];
    reviewNotesByLine[key].push(n);
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
        <UnifiedDiff hunks={diff.hunks} annotationsByLine={annotationsByLine} reviewNotesByLine={reviewNotesByLine} />
      ) : (
        <SplitDiff hunks={diff.hunks} annotationsByLine={annotationsByLine} reviewNotesByLine={reviewNotesByLine} />
      )}
    </div>
  );
}

// A single item in the flattened split diff stream
type SplitItem =
  | { kind: 'separator'; hunkIdx: number; hunk: DiffHunk; gapStart: number; gapEnd: number }
  | { kind: 'pair'; pair: LinePair }
  | { kind: 'annotated'; pair: LinePair; annotations: Annotation[]; reviewNotes: ReviewNoteView[] }
  | { kind: 'tail'; start: number };

function getAnnotations(pair: LinePair, annotationsByLine: Record<string, Annotation[]>): Annotation[] {
  const leftAnns = pair.left ? annotationsByLine[`${pair.left.oldNum}:old`] ?? [] : [];
  const rightAnns = pair.right ? annotationsByLine[`${pair.right.newNum}:new`] ?? [] : [];
  return [...leftAnns, ...rightAnns];
}

function getReviewNotes(pair: LinePair, reviewNotesByLine: Record<string, ReviewNoteView[]>): ReviewNoteView[] {
  // Notes anchor to the new side (the working-tree file the producer wrote against).
  return pair.right ? reviewNotesByLine[`${pair.right.newNum}:new`] ?? [] : [];
}

function SplitDiff({ hunks, annotationsByLine, reviewNotesByLine }: {
  hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]>; reviewNotesByLine: Record<string, ReviewNoteView[]>;
}) {
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
      const notes = getReviewNotes(pair, reviewNotesByLine);
      if (anns.length > 0 || notes.length > 0) {
        items.push({ kind: 'annotated', pair, annotations: anns, reviewNotes: notes });
      } else {
        items.push({ kind: 'pair', pair });
      }
    }
  }
  items.push({ kind: 'tail', start: tailStart });

  // Group consecutive non-annotated items into split-columns blocks. A pair
  // with annotations or review notes breaks the flow so they render full-width.
  type Group =
    | { type: 'columns'; items: Exclude<SplitItem, { kind: 'annotated' }>[] }
    | { type: 'annotated'; pair: LinePair; annotations: Annotation[]; reviewNotes: ReviewNoteView[] };

  const groups: Group[] = [];
  let run: Exclude<SplitItem, { kind: 'annotated' }>[] = [];

  for (const item of items) {
    if (item.kind === 'annotated') {
      if (run.length > 0) { groups.push({ type: 'columns', items: run }); run = []; }
      groups.push({ type: 'annotated', pair: item.pair, annotations: item.annotations, reviewNotes: item.reviewNotes });
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
              {group.annotations.length > 0 ? <AnnotationRows annotations={group.annotations} /> : null}
              {group.reviewNotes.length > 0 ? <ReviewNoteRows notes={group.reviewNotes} /> : null}
            </div>
          );
        }

        // Render as two continuous independent columns
        return (
          <div className="split-columns">
            <div className="split-col split-col-left">
              {renderSplitColumn(group.items, 'left')}
            </div>
            <div className="split-col split-col-right">
              {renderSplitColumn(group.items, 'right')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Render the per-side body of a `.split-col`. Hunk separators and tail
 *  expanders look identical on both sides; only the diff-line rendering
 *  differs by `side`. */
function renderSplitColumn(
  items: Exclude<SplitItem, { kind: 'annotated' }>[],
  side: 'left' | 'right',
): SafeHtml {
  return (
    <>
      {items.map(item => {
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
        if (side === 'left') {
          return (
            <div className={`diff-line split-left ${pair.left?.type || 'empty'}`}
              data-line={pair.left?.oldNum ?? ''} data-side="old"
              data-new-line={pair.left?.newNum ?? pair.right?.newNum ?? ''}>
              <span className="gutter" data-line-number={pair.left?.oldNum ?? ''}></span>
              <span className="code">{renderPairContent(pair, 'left')}</span>
            </div>
          );
        }
        return (
          <div className={`diff-line split-right ${pair.right?.type || 'empty'}`}
            data-line={pair.right?.newNum ?? ''} data-side="new">
            <span className="gutter" data-line-number={pair.right?.newNum ?? ''}></span>
            <span className="code">{renderPairContent(pair, 'right')}</span>
          </div>
        );
      })}
    </>
  );
}

/** Render content with optional character-level diff highlighting. */
function renderSegments(segments: DiffSegment[]): SafeHtml {
  return <>{segments.map(s => s.changed ? <span className="char-change">{s.text}</span> : <>{s.text}</>)}</>;
}

/** Render a plain (non-char-diffed) line's content, truncating pathologically
 *  long lines so the DOM never holds a multi-hundred-KB text node — see
 *  `truncateDiffLine`. The elided remainder stays in the stored diff. */
function renderLineContent(content: string): SafeHtml | string {
  const t = truncateDiffLine(content);
  if (t === null) return content;
  return (
    <>
      {t.text}
      <span className="line-truncated"
        title={`Line too long to display — ${t.fullLength.toLocaleString('en-US')} characters total`}>
        … ⟨{t.hidden.toLocaleString('en-US')} more characters hidden⟩
      </span>
    </>
  );
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
  return renderLineContent(line.content);
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

function UnifiedDiff({ hunks, annotationsByLine, reviewNotesByLine }: {
  hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]>; reviewNotesByLine: Record<string, ReviewNoteView[]>;
}) {
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
            const notes = reviewNotesByLine[`${lineNum}:${side}`] ?? [];
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
                  <span className="code">{segments ? renderSegments(segments) : renderLineContent(line.content)}</span>
                </div>
                {anns.length > 0 ? <AnnotationRows annotations={anns} /> : null}
                {notes.length > 0 ? <ReviewNoteRows notes={notes} /> : null}
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

/** AI-authored review notes (docs/20 §20.6) — rendered review-comment-style,
 *  full-width below their line, styled distinctly as AI-authored (the `ai-note-*`
 *  precedent shared with risk/narrative/guided notes) with a per-kind badge. */
function ReviewNoteRows({ notes }: { notes: ReviewNoteView[] }) {
  return (
    <>
      {notes.map(n => (
        <div className={`ai-note-row ai-note-review${n.stale === true ? ' ai-note-stale' : ''}`}
          data-kind={n.kind} data-note-id={n.guid}>
          <div className="ai-note-item">
            <span className={`ai-note-label ai-note-label-${n.kind}`}>{REVIEW_NOTE_LABELS[n.kind] ?? n.kind}</span>
            {n.stale === true ? <span className="ai-note-stale-tag" title="The code this note referred to has changed">outdated</span> : null}
            <span className="ai-note-text">{n.body}</span>
            {n.producer !== undefined ? <span className="ai-note-producer">{n.producer}</span> : null}
            {n.guid !== undefined ? <button className="ai-note-reply-btn" data-line={String(n.line)}>Reply</button> : null}
          </div>
        </div>
      ))}
    </>
  );
}

function AnnotationRows({ annotations }: { annotations: Annotation[] }) {
  return (
    <div className="annotation-row">
      {annotations.map(a => (
        <div className={`annotation-item${a.is_stale ? ' annotation-stale' : ''}`}
          data-key={a.id} data-annotation-id={a.id} data-is-stale={a.is_stale ? 'true' : undefined}>
          <span className="annotation-drag-handle" draggable={true} title="Drag to move">⠿</span>
          <span className={`annotation-category category-${a.category}`} data-action="reclassify">{a.category}</span>
          {a.reply_to_note_id !== null ? <span className="annotation-reply-tag" title="Reply to an AI review note">↳ reply</span> : null}
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
