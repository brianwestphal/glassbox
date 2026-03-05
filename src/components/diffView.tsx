import type { ReviewFile, Annotation } from '../db/queries.js';
import type { FileDiff, DiffHunk, DiffLine } from '../git/diff.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { raw } from '../jsx-runtime.js';

export function DiffView({ file, diff, annotations, mode }: {
  file: ReviewFile;
  diff: FileDiff;
  annotations: Annotation[];
  mode: 'split' | 'unified';
}) {
  const annotationsByLine: Record<string, Annotation[]> = {};
  for (const a of annotations) {
    const key = `${a.line_number}:${a.side}`;
    if (!annotationsByLine[key]) annotationsByLine[key] = [];
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
      ) : mode === 'split' ? (
        <SplitDiff hunks={diff.hunks} annotationsByLine={annotationsByLine} />
      ) : (
        <UnifiedDiff hunks={diff.hunks} annotationsByLine={annotationsByLine} />
      )}
    </div>
  );
}

function SplitDiff({ hunks, annotationsByLine }: { hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]> }) {
  return (
    <div className="diff-table-split">
      {hunks.map((hunk, hunkIdx) => {
        // Pair up lines: removals on left, additions on right, context on both
        const pairs = pairLines(hunk.lines);
        return (
          <div className="hunk-block">
            <div className="hunk-separator" data-hunk-idx={hunkIdx}
              data-old-start={hunk.oldStart} data-old-count={hunk.oldCount}
              data-new-start={hunk.newStart} data-new-count={hunk.newCount}>
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </div>
            {pairs.map(pair => {
              const leftAnns = pair.left
                ? annotationsByLine[`${pair.left.oldNum}:old`] || []
                : [];
              const rightAnns = pair.right
                ? annotationsByLine[`${pair.right.newNum}:new`] || []
                : [];
              const allAnns = [...leftAnns, ...rightAnns];
              return (
                <div>
                  <div className="split-row">
                    <div className={`diff-line split-left ${pair.left?.type || 'empty'}`}
                      data-line={pair.left?.oldNum ?? ''} data-side="old">
                      <span className="gutter">{pair.left?.oldNum ?? ''}</span>
                      <span className="code">{pair.left ? raw(escapeHtml(pair.left.content)) : ''}</span>
                    </div>
                    <div className={`diff-line split-right ${pair.right?.type || 'empty'}`}
                      data-line={pair.right?.newNum ?? ''} data-side="new">
                      <span className="gutter">{pair.right?.newNum ?? ''}</span>
                      <span className="code">{pair.right ? raw(escapeHtml(pair.right.content)) : ''}</span>
                    </div>
                  </div>
                  {allAnns.length > 0 ? <AnnotationRows annotations={allAnns} /> : null}
                </div>
              );
            })}
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
    } else if (line.type === 'add') {
      pairs.push({ left: null, right: line });
      i++;
    } else {
      i++;
    }
  }
  return pairs;
}

function UnifiedDiff({ hunks, annotationsByLine }: { hunks: DiffHunk[]; annotationsByLine: Record<string, Annotation[]> }) {
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
            const anns = annotationsByLine[`${lineNum}:${side}`] || [];
            return (
              <div>
                <div
                  className={`diff-line ${line.type}${anns.length ? ' has-annotation' : ''}`}
                  data-line={lineNum}
                  data-side={side}
                >
                  <span className="gutter-old">{line.oldNum ?? ''}</span>
                  <span className="gutter-new">{line.newNum ?? ''}</span>
                  <span className="code">{raw(escapeHtml(line.content))}</span>
                </div>
                {anns.length > 0 ? <AnnotationRows annotations={anns} /> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function AnnotationRows({ annotations }: { annotations: Annotation[] }) {
  return (
    <div className="annotation-row">
      {annotations.map(a => (
        <div className="annotation-item" data-annotation-id={a.id}>
          <span className={`annotation-category category-${a.category}`}>{a.category}</span>
          <span className="annotation-text">{a.content}</span>
          <div className="annotation-actions">
            <button className="btn btn-xs" data-action="edit">Edit</button>
            <button className="btn btn-xs btn-danger" data-action="delete">Del</button>
          </div>
        </div>
      ))}
    </div>
  );
}
