import type { SafeHtml } from 'kerfjs';
import { raw } from 'kerfjs';

import type { Annotation,ReviewFile } from '../db/queries.js';
import type { DiffHunk, DiffLine,FileDiff } from '../git/diff.js';
import { isImageFile, isSvgFile } from '../git/image.js';
import type { GroundTruthStepNav } from '../ground-truth/presentation.js';
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronsUpDown, IconCornerDownRight, IconEdit, IconExternalLink, IconGripVertical, IconPaperclip, IconReveal, IconTrash } from '../icons.js';
import type { NoteOrigin, ReviewNoteView } from '../review-notes/view.js';
import { REVIEW_NOTE_LABELS } from '../review-notes/view.js';
import { charDiff, type DiffSegment } from '../utils/charDiff.js';
import { formatDiffPct } from '../utils/diffScore.js';
import { truncateDiffLine } from '../utils/lineTruncate.js';
import { renderNoteMarkdown } from '../utils/noteMarkdown.js';
import { ImageDiff } from './imageDiff.js';
import { ReviewNoteRegionThumb } from './reviewNoteRegionThumb.js';

export function DiffView({ file, diff, annotations, mode, reviewNotes = [], imageSideLabels, stepNav }: {
  file: ReviewFile;
  diff: FileDiff;
  annotations: Annotation[];
  mode: 'split' | 'unified';
  reviewNotes?: ReviewNoteView[];
  /** Ground-truth mode (doc 26 §26.1) overrides the image pane captions. */
  imageSideLabels?: { old: string; new: string };
  /** Ground-truth set step navigator (doc 26 §26.3 FR-26.12); absent for singles. */
  stepNav?: GroundTruthStepNav;
}) {
  // Replies (annotations linked to a review note on this file) render nested
  // beneath their note, not on their line; everything else goes by line. An
  // orphan reply — whose note isn't among this file's notes — falls back to
  // line rendering so it's never lost.
  const loadedNoteGuids = new Set(reviewNotes.map(n => n.guid).filter((g): g is string => g !== undefined));
  const repliesByNote: Record<string, Annotation[]> = {};
  const annotationsByLine: Record<string, Annotation[]> = {};
  for (const a of annotations) {
    if (a.reply_to_note_id !== null && loadedNoteGuids.has(a.reply_to_note_id)) {
      (repliesByNote[a.reply_to_note_id] ??= []).push(a);
      continue;
    }
    const key = `${a.line_number}:${a.side}`;
    (annotationsByLine[key] ??= []).push(a);
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
          {stepNav ? <StepNav nav={stepNav} /> : null}
          {file.difference_score !== null ? (
            <span className="diff-score-badge" title="Perceptual difference from the expected image (doc 26)">{formatDiffPct(file.difference_score)} different</span>
          ) : null}
          <span className={`file-status ${diff.status}`}>{diff.status}</span>
        </div>
      </div>
      {diff.isBinary && isImageFile(diff.filePath) ? (
        <ImageDiff file={file} diff={diff} sideLabels={imageSideLabels} />
      ) : diff.isBinary ? (
        <div className="hunk-separator">Binary file</div>
      ) : (diff.status === 'added' || diff.status === 'deleted' || mode === 'unified') ? (
        <UnifiedDiff hunks={diff.hunks} annotationsByLine={annotationsByLine} reviewNotesByLine={reviewNotesByLine} repliesByNote={repliesByNote} filePath={diff.filePath} />
      ) : (
        <SplitDiff hunks={diff.hunks} annotationsByLine={annotationsByLine} reviewNotesByLine={reviewNotesByLine} repliesByNote={repliesByNote} filePath={diff.filePath} />
      )}
    </div>
  );
}

/** Ground-truth per-step navigator (doc 26 §26.3 FR-26.12): "Step k of N" with
 *  Prev/Next bounded to the current set. The buttons carry the sibling step's
 *  review-file id; the diff container's delegate handler calls `selectFile`.
 *  A button with no sibling renders disabled (set boundary). */
function StepNav({ nav }: { nav: GroundTruthStepNav }) {
  const human = nav.stepIndex + 1;
  const setName = nav.setLabel !== '' ? nav.setLabel : 'Set';
  return (
    <span className="gt-step-nav" title={`${setName}: ${nav.label}`}>
      <button className="gt-step-btn" data-step-file-id={nav.prevFileId ?? undefined}
        disabled={nav.prevFileId === null} title="Previous step"><IconChevronLeft /></button>
      <span className="gt-step-label">Step {String(human)} of {String(nav.stepCount)}</span>
      <button className="gt-step-btn" data-step-file-id={nav.nextFileId ?? undefined}
        disabled={nav.nextFileId === null} title="Next step"><IconChevronRight /></button>
    </span>
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

function SplitDiff({ hunks, annotationsByLine, reviewNotesByLine, repliesByNote, filePath }: {
  hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]>; reviewNotesByLine: Record<string, ReviewNoteView[]>; repliesByNote: Record<string, Annotation[]>; filePath: string;
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
              {group.reviewNotes.length > 0 ? <ReviewNoteRows notes={group.reviewNotes} repliesByNote={repliesByNote} filePath={filePath} /> : null}
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
              <IconChevronsUpDown /> Show remaining lines
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

function UnifiedDiff({ hunks, annotationsByLine, reviewNotesByLine, repliesByNote, filePath }: {
  hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]>; reviewNotesByLine: Record<string, ReviewNoteView[]>; repliesByNote: Record<string, Annotation[]>; filePath: string;
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
                {notes.length > 0 ? <ReviewNoteRows notes={notes} repliesByNote={repliesByNote} filePath={filePath} /> : null}
              </div>
            );
          })}
        </div>
        );
      })}
      <div className="hunk-separator hunk-expander-tail" data-start={tailStart}>
        <IconChevronsUpDown /> Show remaining lines
      </div>
    </div>
  );
}

/** Origin-commit provenance label for a review note (docs/20 §20.6, GB-1142):
 *  a clickable `<shortSha> <subject>` line at the bottom of the note that
 *  expands to the full commit message. The message toggles via a `delegate()`
 *  handler on the diff container (`.ai-note-commit`). Shows the short hash alone
 *  when git couldn't resolve the subject. */
function NoteCommitLabel({ origin, filePath, line }: { origin: NoteOrigin; filePath: string; line: number }) {
  const hasSubject = origin.subject !== undefined && origin.subject !== '';
  const hasMessage = origin.message !== undefined && origin.message !== '';
  return (
    <div className="ai-note-commit-wrap">
      <button type="button" className="ai-note-commit" data-note-commit={origin.sha}
        title="Commit this note was written for — click to show the full message">
        <IconChevronDown />
        <span className="ai-note-commit-sha">{origin.shortSha}</span>
        {hasSubject ? <span className="ai-note-commit-subject">{origin.subject}</span> : null}
      </button>
      {/* Open this commit as its own review, jumping to the note's file+line
          (doc 34, GB-1144). Carries the sha + the note's location for the
          `.ai-note-open-commit` delegate in diff/index.tsx. */}
      <button type="button" className="ai-note-open-commit" data-open-commit={origin.sha}
        data-open-file={filePath} data-open-line={String(line)}
        title="Open this commit as a review, jumping to this note's line">
        <IconExternalLink />
        <span>Open commit</span>
      </button>
      {hasMessage ? <pre className="ai-note-commit-message" hidden>{origin.message}</pre> : null}
    </div>
  );
}

/** Server-render the review-note rows for a single line to an HTML string, for
 *  the context-expansion path (doc 20 §20.6, GB-1139): when the user expands a
 *  collapsed region, the `/context` route returns this markup and the client
 *  splices it in. The markup is identical to what `ReviewNoteRows` renders
 *  inline, so revealed notes look exactly like in-diff notes (and the diff
 *  container's `delegate()` handlers drive their Reply/Keep/Discard for free). */
export function renderReviewNoteRowsHtml(notes: ReviewNoteView[], repliesByNote: Record<string, Annotation[]>, filePath: string): string {
  return (<ReviewNoteRows notes={notes} repliesByNote={repliesByNote} filePath={filePath} />).toString();
}

/** AI-authored review notes (docs/20 §20.6) — rendered review-comment-style,
 *  full-width below their line, styled distinctly as AI-authored (the `ai-note-*`
 *  precedent shared with risk/narrative/guided notes) with a per-kind badge. */
function ReviewNoteRows({ notes, repliesByNote, filePath }: { notes: ReviewNoteView[]; repliesByNote: Record<string, Annotation[]>; filePath: string }) {
  return (
    <>
      {notes.map(n => {
        const replies = n.guid !== undefined ? repliesByNote[n.guid] ?? [] : [];
        return (
        <>
        {/* Outdated (stale) notes are not rendered at all (doc 20 §20.3, GB-1140):
            the render sites filter `n.stale`, so a note reaching here is current
            relative to what's being reviewed. */}
        <div className="ai-note-row ai-note-review" data-kind={n.kind} data-note-id={n.guid}>
          <div className="ai-note-item">
            <span className={`ai-note-label ai-note-label-${n.kind}`}>{REVIEW_NOTE_LABELS[n.kind] ?? n.kind}</span>
            {/* A div, not a span: the body renders block-level markdown (doc 20 §20.6).
                renderNoteMarkdown returns SafeHtml, so it embeds directly. */}
            <div className="ai-note-text">{renderNoteMarkdown(n.body, n.related)}</div>
            {n.producer !== undefined ? <span className="ai-note-producer">{n.producer}</span> : null}
            {n.guid !== undefined ? <button className="ai-note-reply-btn" data-line={String(n.line)}>Reply</button> : null}
          </div>
          {n.artifacts !== undefined && n.artifacts.length > 0 ? (
            <div className="ai-note-artifacts">
              {n.artifacts.map(a => (
                a.renderedSvg !== undefined ? (
                  <details className="ai-note-artifact" open>
                    <summary className="ai-note-artifact-label"><IconPaperclip /><span>{a.uri}</span></summary>
                    <div className="ai-note-artifact-imgwrap">
                      {/* kerf 1.0+ screens `data:image/svg+xml` out of src (an SVG *document* can
                          script; an SVG in an <img> cannot — no script execution, no external
                          loads, the GB-932 rationale). The SVG is plugin-rendered from trusted
                          opt-in-installed code (doc 29 §29.6) and encodeURIComponent leaves no
                          quote to break out of the attribute, so raw() is the documented opt-out. */}
                      <img className="ai-note-artifact-img" loading="lazy" alt={a.uri} draggable="false"
                        // eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- trusted plugin SVG (opt-in install; doc 29 §29.6), inert in <img> context (NFR-29.2)
                        src={raw(`data:image/svg+xml;utf8,${encodeURIComponent(a.renderedSvg)}`)} />
                    </div>
                  </details>
                ) : a.renderedHtml !== undefined ? (
                  <details className="ai-note-artifact" open>
                    <summary className="ai-note-artifact-label"><IconPaperclip /><span>{a.uri}</span></summary>
                    {/* eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- plugin-rendered HTML is trusted (opt-in install; doc 29 FR-29.15) and required to be inert (NFR-29.2) */}
                    <div className="ai-note-artifact-rendered">{raw(a.renderedHtml)}</div>
                  </details>
                ) : a.content !== undefined ? (
                  <details className="ai-note-artifact">
                    <summary className="ai-note-artifact-label"><IconPaperclip /><span>{a.uri}</span></summary>
                    <pre className="ai-note-artifact-content"><code>{a.content}</code></pre>
                  </details>
                ) : a.isImage === true ? (
                  <details className="ai-note-artifact">
                    <summary className="ai-note-artifact-label"><IconPaperclip /><span>{a.uri}</span></summary>
                    <div className="ai-note-artifact-imgwrap">
                      <img className="ai-note-artifact-img" loading="lazy" alt={a.uri} draggable="false"
                        data-artifact-uri={a.uri} title="Drag to mark a region, or click to view full screen"
                        src={`/api/review-notes/artifact?file=${encodeURIComponent(a.uri)}`} />
                      <div className="ai-note-artifact-region-overlay" data-artifact-uri={a.uri}></div>
                    </div>
                  </details>
                ) : (
                  <div className="ai-note-artifact ai-note-artifact-ref ai-note-artifact-label"><IconPaperclip /><span>{a.uri}</span></div>
                )
              ))}
            </div>
          ) : null}
          {n.origin !== undefined ? <NoteCommitLabel origin={n.origin} filePath={filePath} line={n.line} /> : null}
        </div>
        {replies.length > 0 ? (
          <div className="annotation-row ai-note-replies">
            {replies.map(a => <AnnotationItem annotation={a} />)}
          </div>
        ) : null}
        </>
        );
      })}
    </>
  );
}

function AnnotationItem({ annotation: a }: { annotation: Annotation }) {
  return (
    <div className={`annotation-item${a.is_stale ? ' annotation-stale' : ''}`}
      data-key={a.id} data-annotation-id={a.id} data-is-stale={a.is_stale ? 'true' : undefined}
      data-region-data={a.region_data ?? undefined}>
      <span className="annotation-drag-handle" draggable="true" title="Drag to move"><IconGripVertical /></span>
      <span className={`annotation-category category-${a.category}`} data-action="reclassify">{a.category}</span>
      {a.reply_to_note_id !== null ? <span className="annotation-reply-tag" title="Reply to an AI review note"><IconCornerDownRight /> reply</span> : null}
      <span className="annotation-text">{a.content}</span>
      {ReviewNoteRegionThumb({ regionData: a.region_data })}
      <div className="annotation-actions">
        {a.is_stale ? <button className="btn btn-xs btn-keep" data-action="keep">Keep</button> : null}
        <button className="btn btn-xs btn-icon" data-action="attach" title="Attach a file"><IconPaperclip /></button>
        <button className="btn btn-xs btn-icon" data-action="edit" title="Edit"><IconEdit /></button>
        <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete"><IconTrash /></button>
      </div>
      <div className="annotation-attachments" data-att-list={a.id} data-morph-skip></div>
    </div>
  );
}

function AnnotationRows({ annotations }: { annotations: Annotation[] }) {
  return (
    <div className="annotation-row">
      {annotations.map(a => <AnnotationItem annotation={a} />)}
    </div>
  );
}
