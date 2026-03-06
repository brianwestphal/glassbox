import { api } from '../api.js';
import { toElement } from '../dom.js';
import { state } from '../state.js';
import { applyHighlighting } from './highlight.js';
import { bindDiffLineClicks } from './lineClicks.js';

export function bindHunkExpanders() {
  document.querySelectorAll('.hunk-separator').forEach(el => {
    el.addEventListener('click', () => {
      const diffView = document.querySelector<HTMLElement>('.diff-view');
      const fileId = diffView?.dataset.fileId;
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

        const fragment = document.createDocumentFragment();
        data.lines.forEach((line) => {
          const contextLine = (side: string) => (
            <div className="diff-line context expanded-context" data-line={String(line.num)} data-side={side}>
              <span className="gutter">{line.num}</span>
              <span className="code">{line.content}</span>
            </div>
          );

          if (state.diffMode === 'split') {
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
        });

        el.replaceWith(fragment);
        applyHighlighting();
        bindDiffLineClicks();
      })();
    });
  });
}
