import { raw } from 'kerfjs';

import type { ContextNote } from '../../api/index.js';
import { getContextLines } from '../../api/index.js';
import { asEl, toElement } from '../dom.js';
import { postHunkExpand } from './index.js';

/** Map of new-side line number → server-rendered review-note-rows HTML for the
 *  revealed range (doc 20 §20.6, GB-1139). */
type NotesByLine = Map<number, string>;

function notesByLine(notes: ContextNote[] | undefined): NotesByLine {
  const m: NotesByLine = new Map();
  for (const n of notes ?? []) m.set(n.line, n.html);
  return m;
}

/** A full-width review-note block (the `.ai-note-row`s), for inserting between
 *  context lines. `raw()` embeds the trusted server-rendered markup verbatim. */
function noteBlock(html: string): HTMLElement {
  // eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- server-rendered note rows from our own /context route (doc 20 §20.6)
  return toElement(<div>{raw(html)}</div>);
}

function buildUnifiedContextLines(lines: Array<{ num: number; content: string }>, notes: NotesByLine): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    const note = notes.get(line.num);
    fragment.appendChild(toElement(
      <div>
        <div className="diff-line context expanded-context" data-line={String(line.num)} data-side="new">
          <span className="gutter-old" data-line-number={String(line.num)}></span>
          <span className="gutter-new" data-line-number={String(line.num)}></span>
          <span className="code">{line.content}</span>
        </div>
        {/* eslint-disable-next-line kerfjs/no-raw-with-dynamic-arg -- server-rendered note rows (doc 20 §20.6) */}
        {note !== undefined ? raw(note) : null}
      </div>
    ));
  }
  return fragment;
}

function buildSplitContextLine(line: { num: number; content: string }, side: 'left' | 'right'): HTMLElement {
  return toElement(
    <div className={`diff-line split-${side} context expanded-context`}
      data-line={String(line.num)} data-side={side === 'left' ? 'old' : 'new'}>
      <span className="gutter" data-line-number={String(line.num)}></span>
      <span className="code">{line.content}</span>
    </div>
  );
}

function buildSplitContextLines(lines: Array<{ num: number; content: string }>, side: 'left' | 'right'): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const line of lines) fragment.appendChild(buildSplitContextLine(line, side));
  return fragment;
}

function getFileId(): string | undefined {
  return document.querySelector<HTMLElement>('.diff-view')?.dataset.fileId;
}

/** Find the matching separator in the other column by data-hunk-idx */
function findOtherSeparator(el: Element, splitCol: Element): HTMLElement | null {
  const splitColumns = splitCol.closest('.split-columns');
  if (splitColumns === null) return null;
  const hunkIdx = asEl(el).dataset.hunkIdx;
  const isLeft = splitCol.classList.contains('split-col-left');
  const otherColClass = isLeft ? 'split-col-right' : 'split-col-left';
  return splitColumns.querySelector<HTMLElement>(`.${otherColClass} .hunk-separator[data-hunk-idx="${hunkIdx}"]`);
}

/** Build a fresh `.split-columns` block from the given per-side line nodes. */
function makeSplitColumns(leftNodes: Node[], rightNodes: Node[]): HTMLElement {
  const block = toElement(
    <div className="split-columns">
      <div className="split-col split-col-left"></div>
      <div className="split-col split-col-right"></div>
    </div>
  );
  const left = block.querySelector('.split-col-left');
  const right = block.querySelector('.split-col-right');
  leftNodes.forEach(n => left?.appendChild(n));
  rightNodes.forEach(n => right?.appendChild(n));
  return block;
}

/** Split a column's children around `sep` into [before, after], excluding `sep`. */
function partitionColumn(col: Element, sep: Element | null): [Element[], Element[]] {
  const before: Element[] = [];
  const after: Element[] = [];
  let seen = false;
  for (const child of Array.from(col.children)) {
    if (child === sep) { seen = true; continue; }
    (seen ? after : before).push(child);
  }
  return [before, after];
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

/** Expand a split-mode gap that contains review notes (doc 20 §20.6, GB-1139).
 *  Note rows are full-width, so they can't live inside a `.split-col`: the
 *  parent `.split-columns` block is partitioned around the separator and rebuilt
 *  as [before-columns] + [revealed region with full-width notes] + [after-columns].
 *  Returns false if the DOM isn't the expected shape, so the caller falls back
 *  to the plain in-column splice. */
function expandSplitWithNotes(
  el: Element,
  splitCol: Element,
  otherEl: Element | null,
  lines: Array<{ num: number; content: string }>,
  notes: NotesByLine,
): boolean {
  const block = splitCol.closest('.split-columns');
  const leftCol = block?.querySelector('.split-col-left');
  const rightCol = block?.querySelector('.split-col-right');
  if (block === null || leftCol == null || rightCol == null || otherEl === null) return false;

  const isLeft = splitCol.classList.contains('split-col-left');
  const leftSep = isLeft ? el : otherEl;
  const rightSep = isLeft ? otherEl : el;

  const [leftBefore, leftAfter] = partitionColumn(leftCol, leftSep);
  const [rightBefore, rightAfter] = partitionColumn(rightCol, rightSep);

  const out: Node[] = [];
  if (leftBefore.length > 0 || rightBefore.length > 0) out.push(makeSplitColumns(leftBefore, rightBefore));

  // Revealed region: accumulate context-line runs, breaking to a full-width note
  // block after any line that carries notes (the line stays in the columns).
  let runL: Node[] = [];
  let runR: Node[] = [];
  const flush = () => {
    if (runL.length > 0 || runR.length > 0) { out.push(makeSplitColumns(runL, runR)); runL = []; runR = []; }
  };
  for (const line of lines) {
    runL.push(buildSplitContextLine(line, 'left'));
    runR.push(buildSplitContextLine(line, 'right'));
    const note = notes.get(line.num);
    if (note !== undefined) { flush(); out.push(noteBlock(note)); }
  }
  flush();

  if (leftAfter.length > 0 || rightAfter.length > 0) out.push(makeSplitColumns(leftAfter, rightAfter));

  block.replaceWith(...out);
  return true;
}

/** Click handler for a hunk-separator (or tail expander). Surgical: inserts the
 *  fetched context lines into the live tree in place of the separator. Safe to
 *  run under `data-morph-skip` because the parent never re-renders that subtree. */
export function handleHunkExpand(el: HTMLElement): void {
  const fileId = getFileId();
  if (fileId === undefined || fileId === '') return;

  if (el.classList.contains('hunk-expander-tail')) {
    handleTailExpand(el, fileId);
    return;
  }

  const splitCol = el.closest('.split-col');
  let gapStart: number;
  let gapEnd: number;

  if (splitCol !== null) {
    gapStart = parseInt(el.dataset.gapStart ?? '0', 10);
    gapEnd = parseInt(el.dataset.gapEnd ?? '0', 10);
  } else {
    const hunkBlock = el.closest('.hunk-block');
    const prevBlock = hunkBlock?.previousElementSibling;
    const newStart = parseInt(el.dataset.newStart ?? '0', 10);
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
    const data = await getContextLines({ fileId, start: gapStart, end: gapEnd });
    if (data.lines.length === 0) return;
    const notes = notesByLine(data.notes);

    if (splitCol !== null) {
      const otherSep = findOtherSeparator(el, splitCol);
      if (notes.size === 0 || !expandSplitWithNotes(el, splitCol, otherSep, data.lines, notes)) {
        replaceSplitSeparators(el, splitCol, otherSep, data.lines);
      }
    } else {
      el.replaceWith(buildUnifiedContextLines(data.lines, notes));
    }
    postHunkExpand();
  })();
}

function handleTailExpand(el: HTMLElement, fileId: string): void {
  const start = parseInt(el.dataset.start ?? '0', 10);
  if (start <= 0) return;

  const splitCol = el.closest('.split-col');

  void (async () => {
    const data = await getContextLines({ fileId, start, end: 999999 });
    if (data.lines.length === 0) {
      if (splitCol !== null) {
        const splitColumns = splitCol.closest('.split-columns');
        splitColumns?.querySelectorAll('.hunk-expander-tail').forEach(t => { t.remove(); });
      } else {
        el.remove();
      }
      return;
    }
    const notes = notesByLine(data.notes);

    if (splitCol !== null) {
      const splitColumns = splitCol.closest('.split-columns');
      const isLeft = splitCol.classList.contains('split-col-left');
      const otherColClass = isLeft ? 'split-col-right' : 'split-col-left';
      const otherTail = splitColumns?.querySelector<HTMLElement>(`.${otherColClass} .hunk-expander-tail`) ?? null;
      if (notes.size === 0 || !expandSplitWithNotes(el, splitCol, otherTail, data.lines, notes)) {
        replaceSplitSeparators(el, splitCol, otherTail, data.lines);
      }
    } else {
      el.replaceWith(buildUnifiedContextLines(data.lines, notes));
    }
    postHunkExpand();
  })();
}
