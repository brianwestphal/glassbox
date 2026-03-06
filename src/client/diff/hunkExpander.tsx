import { state } from '../state.js';
import { api } from '../api.js';
import { toElement } from '../dom.js';
import { bindDiffLineClicks } from './lineClicks.js';
import { applyHighlighting } from './highlight.js';

export function bindHunkExpanders() {
  document.querySelectorAll('.hunk-separator').forEach(el => {
    el.addEventListener('click', async () => {
      const fileId = (document.querySelector('.diff-view') as HTMLElement | null)?.dataset?.fileId;
      if (!fileId) return;

      const hunkBlock = el.closest('.hunk-block');
      const prevBlock = hunkBlock?.previousElementSibling;

      const newStart = parseInt((el as HTMLElement).dataset.newStart!, 10);
      let gapStart = 1;
      if (prevBlock) {
        const prevSep = prevBlock.querySelector('.hunk-separator') as HTMLElement | null;
        if (prevSep) {
          gapStart = parseInt(prevSep.dataset.newStart!, 10) + parseInt(prevSep.dataset.newCount!, 10);
        }
      }
      const gapEnd = newStart - 1;
      if (gapEnd < gapStart) return;

      const data = await api('/context/' + fileId + '?start=' + gapStart + '&end=' + gapEnd);
      if (!data.lines || !data.lines.length) return;

      const fragment = document.createDocumentFragment();
      data.lines.forEach((line: { num: number; content: string }) => {
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
    });
  });
}
