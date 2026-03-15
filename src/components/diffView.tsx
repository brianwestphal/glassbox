import type { Annotation,ReviewFile } from '../db/queries.js';
import type { DiffHunk, DiffLine,FileDiff } from '../git/diff.js';
import { raw } from '../jsx-runtime.js';
import { escapeHtml } from '../utils/escapeHtml.js';

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
    <div className="diff-view" data-file-id={file.id} data-file-path={file.file_path}>
      <div className="diff-header">
        <span className="file-path">{diff.filePath}</span>
        <div className="diff-header-actions">
          <span className={`file-status ${diff.status}`}>{diff.status}</span>
        </div>
      </div>
      {diff.isBinary ? (
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
                  <span className="code">{group.pair.left ? raw(escapeHtml(group.pair.left.content)) : ''}</span>
                </div>
                <div className={`diff-line split-right ${group.pair.right?.type || 'empty'}`}
                  data-line={group.pair.right?.newNum ?? ''} data-side="new">
                  <span className="gutter" data-line-number={group.pair.right?.newNum ?? ''}></span>
                  <span className="code">{group.pair.right ? raw(escapeHtml(group.pair.right.content)) : ''}</span>
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
                    <span className="code">{pair.left ? raw(escapeHtml(pair.left.content)) : ''}</span>
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
                    <span className="code">{pair.right ? raw(escapeHtml(pair.right.content)) : ''}</span>
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

function UnifiedDiff({ hunks, annotationsByLine }: { hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]> }) {
  const lastHunk = hunks[hunks.length - 1] as DiffHunk | undefined;
  const tailStart = lastHunk ? lastHunk.newStart + lastHunk.newCount : 1;

  return (
    <div className="diff-table-unified">
      {hunks.map((hunk, hunkIdx) => (
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
            return (
              <div>
                <div
                  className={`diff-line ${line.type}${anns.length ? ' has-annotation' : ''}`}
                  data-line={lineNum}
                  data-side={side}
                >
                  <span className="gutter-old" data-line-number={line.oldNum ?? ''}></span>
                  <span className="gutter-new" data-line-number={line.newNum ?? ''}></span>
                  <span className="code">{raw(escapeHtml(line.content))}</span>
                </div>
                {anns.length > 0 ? <AnnotationRows annotations={anns} /> : null}
              </div>
            );
          })}
        </div>
      ))}
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
          <span className="annotation-drag-handle" draggable="true" title="Drag to move">⠿</span>
          <span className={`annotation-category category-${a.category}`} data-action="reclassify">{a.category}</span>
          <span className="annotation-text">{a.content}</span>
          <div className="annotation-actions">
            {a.is_stale ? <button className="btn btn-xs btn-keep" data-action="keep">Keep</button> : null}
            <button className="btn btn-xs btn-icon" data-action="edit" title="Edit">{raw('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>')}</button>
            <button className="btn btn-xs btn-icon btn-danger" data-action="delete" title="Delete">{raw('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
