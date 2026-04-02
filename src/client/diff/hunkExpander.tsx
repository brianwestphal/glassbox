import { api } from '../api.js';
import { toElement } from '../dom.js';
import { applyHighlighting } from './highlight.js';
import { bindDiffLineClicks } from './lineClicks.js';
import { syncSplitColumnHeights } from './splitSync.js';

function buildUnifiedContextLines(lines: Array<{ num: number; content: string }>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    fragment.appendChild(toElement(
      <div>
        <div className="diff-line context expanded-context" data-line={String(line.num)} data-side="new">
          <span className="gutter-old" data-line-number={String(line.num)}></span>
          <span className="gutter-new" data-line-number={String(line.num)}></span>
          <span className="code">{line.content}</span>
        </div>
      </div>
    ));
  }
  return fragment;
}

function buildSplitContextLines(lines: Array<{ num: number; content: string }>, side: 'left' | 'right'): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    fragment.appendChild(toElement(
      <div className={`diff-line split-${side} context expanded-context`}
        data-line={String(line.num)} data-side={side === 'left' ? 'old' : 'new'}>
        <span className="gutter" data-line-number={String(line.num)}></span>
        <span className="code">{line.content}</span>
      </div>
    ));
  }
  return fragment;
}

function getFileId(): string | undefined {
  return document.querySelector<HTMLElement>('.diff-view')?.dataset.fileId;
}

/** Find the matching separator in the other column by data-hunk-idx */
function findOtherSeparator(el: Element, splitCol: Element): HTMLElement | null {
  const splitColumns = splitCol.closest('.split-columns');
  if (splitColumns === null) return null;
  const hunkIdx = (el as HTMLElement).dataset.hunkIdx;
  const isLeft = splitCol.classList.contains('split-col-left');
  const otherColClass = isLeft ? 'split-col-right' : 'split-col-left';
  return splitColumns.querySelector<HTMLElement>(`.${otherColClass} .hunk-separator[data-hunk-idx="${hunkIdx}"]`);
}

function replaceSplitSeparators(
  el: Element,
  splitCol: Element,
  otherEl: Element | null,
  lines: Array<{ num: number; content: string }>
) {
  const isLeft = splitCol.classList.contains('split-col-left');
  const leftLines = buildSplitContextLines(lines, 'left');
  const rightLines = buildSplitContextLines(lines, 'right');

  if (isLeft) {
    el.replaceWith(leftLines);
    if (otherEl !== null) otherEl.replaceWith(rightLines);
  } else {
    el.replaceWith(rightLines);
    if (otherEl !== null) otherEl.replaceWith(leftLines);
  }
}

export function bindHunkExpanders() {
  document.querySelectorAll('.hunk-separator:not(.hunk-expander-tail)').forEach(el => {
    el.addEventListener('click', () => {
      const fileId = getFileId();
      if (fileId === undefined || fileId === '') return;

      const splitCol = el.closest('.split-col');
      let gapStart: number;
      let gapEnd: number;

      if (splitCol !== null) {
        // Split mode: use pre-computed data attributes
        gapStart = parseInt((el as HTMLElement).dataset.gapStart ?? '0', 10);
        gapEnd = parseInt((el as HTMLElement).dataset.gapEnd ?? '0', 10);
      } else {
        // Unified mode: compute from DOM structure
        const hunkBlock = el.closest('.hunk-block');
        const prevBlock = hunkBlock?.previousElementSibling;
        const newStart = parseInt((el as HTMLElement).dataset.newStart ?? '0', 10);
        gapStart = 1;
        if (prevBlock !== undefined && prevBlock !== null) {
          const prevSep = prevBlock.querySelector<HTMLElement>('.hunk-separator');
          if (prevSep !== null) {
            gapStart = parseInt(prevSep.dataset.newStart ?? '0', 10) + parseInt(prevSep.dataset.newCount ?? '0', 10);
          }
        }
        gapEnd = newStart - 1;
      }

      if (gapEnd < gapStart) return;

      void (async () => {
        const data = await api<{ lines: Array<{ num: number; content: string }> }>(`/context/${fileId}?start=${String(gapStart)}&end=${String(gapEnd)}`);
        if (data.lines.length === 0) return;

        if (splitCol !== null) {
          const otherSep = findOtherSeparator(el, splitCol);
          replaceSplitSeparators(el, splitCol, otherSep, data.lines);
        } else {
          el.replaceWith(buildUnifiedContextLines(data.lines));
        }

        applyHighlighting();
        syncSplitColumnHeights();
        bindDiffLineClicks();
      })();
    });
  });

  document.querySelectorAll('.hunk-expander-tail').forEach(el => {
    el.addEventListener('click', () => {
      const fileId = getFileId();
      if (fileId === undefined || fileId === '') return;

      const start = parseInt((el as HTMLElement).dataset.start ?? '0', 10);
      if (start <= 0) return;

      const splitCol = el.closest('.split-col');

      void (async () => {
        const data = await api<{ lines: Array<{ num: number; content: string }> }>(`/context/${fileId}?start=${String(start)}&end=999999`);
        if (data.lines.length === 0) {
          if (splitCol !== null) {
            // Remove both tail expanders
            const splitColumns = splitCol.closest('.split-columns');
            splitColumns?.querySelectorAll('.hunk-expander-tail').forEach(t => { t.remove(); });
          } else {
            el.remove();
          }
          return;
        }

        if (splitCol !== null) {
          // Find matching tail in the other column
          const splitColumns = splitCol.closest('.split-columns');
          const isLeft = splitCol.classList.contains('split-col-left');
          const otherColClass = isLeft ? 'split-col-right' : 'split-col-left';
          const otherTail = splitColumns?.querySelector<HTMLElement>(`.${otherColClass} .hunk-expander-tail`) ?? null;
          replaceSplitSeparators(el, splitCol, otherTail, data.lines);
        } else {
          el.replaceWith(buildUnifiedContextLines(data.lines));
        }

        applyHighlighting();
        syncSplitColumnHeights();
        bindDiffLineClicks();
      })();
    });
  });
}
