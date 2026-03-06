import { api } from '../api.js';
import { toElement } from '../dom.js';
import { state } from '../state.js';
import { applyHighlighting } from './highlight.js';
import { bindDiffLineClicks } from './lineClicks.js';

function buildContextFragment(lines: Array<{ num: number; content: string }>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    if (state.diffMode === 'split') {
      const contextLine = (side: string) => (
        <div className="diff-line context expanded-context" data-line={String(line.num)} data-side={side}>
          <span className="gutter">{line.num}</span>
          <span className="code">{line.content}</span>
        </div>
      );
      fragment.appendChild(toElement(
        <div>
          <div className="split-row">
            {contextLine('old')}
            {contextLine('new')}
          </div>
        </div>
      ));
    } else {
      fragment.appendChild(toElement(
        <div>
          <div className="diff-line context expanded-context" data-line={String(line.num)} data-side="new">
            <span className="gutter-old">{line.num}</span>
            <span className="gutter-new">{line.num}</span>
            <span className="code">{line.content}</span>
          </div>
        </div>
      ));
    }
  }
  return fragment;
}

function getFileId(): string | undefined {
  return document.querySelector<HTMLElement>('.diff-view')?.dataset.fileId;
}

export function bindHunkExpanders() {
  document.querySelectorAll('.hunk-separator:not(.hunk-expander-tail)').forEach(el => {
    el.addEventListener('click', () => {
      const fileId = getFileId();
      if (fileId === undefined || fileId === '') return;

      const hunkBlock = el.closest('.hunk-block');
      const prevBlock = hunkBlock?.previousElementSibling;

      const newStart = parseInt((el as HTMLElement).dataset.newStart ?? '0', 10);
      let gapStart = 1;
      if (prevBlock !== undefined && prevBlock !== null) {
        const prevSep = prevBlock.querySelector<HTMLElement>('.hunk-separator');
        if (prevSep !== null) {
          gapStart = parseInt(prevSep.dataset.newStart ?? '0', 10) + parseInt(prevSep.dataset.newCount ?? '0', 10);
        }
      }
      const gapEnd = newStart - 1;
      if (gapEnd < gapStart) return;

      void (async () => {
        const data = await api<{ lines: Array<{ num: number; content: string }> }>(`/context/${fileId}?start=${String(gapStart)}&end=${String(gapEnd)}`);
        if (data.lines.length === 0) return;

        el.replaceWith(buildContextFragment(data.lines));
        applyHighlighting();
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

      void (async () => {
        const data = await api<{ lines: Array<{ num: number; content: string }> }>(`/context/${fileId}?start=${String(start)}&end=999999`);
        if (data.lines.length === 0) {
          el.remove();
          return;
        }

        el.replaceWith(buildContextFragment(data.lines));
        applyHighlighting();
        bindDiffLineClicks();
      })();
    });
  });
}
