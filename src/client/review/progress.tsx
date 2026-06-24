import { effect } from 'kerfjs';

import { toElement } from '../dom.js';
import { reviewStore } from '../stores/index.js';

/** Set up the progress bar reactively. Creates the bar once (if missing) and
 *  registers an `effect()` that updates the fill width + summary text
 *  whenever `reviewStore.state.value.files` changes. No more manual
 *  `updateProgress()` calls scattered through the codebase — adding /
 *  removing / marking-as-reviewed any file flows through the store and
 *  re-runs this effect synchronously. */
export function initProgress(): void {
  let bar = document.querySelector('.progress-bar');
  if (bar === null) {
    bar = toElement(
      <div className="progress-bar">
        <div className="progress-bar-fill"></div>
      </div>
    );
    const controls = document.querySelector('.sidebar-controls');
    if (controls !== null) controls.appendChild(bar);
  }
  const fill = bar.querySelector<HTMLElement>('.progress-bar-fill');

  effect(() => {
    const state = reviewStore.state.value;
    const files = state.files;
    const total = files.length;
    const reviewed = files.filter(f => f.status === 'reviewed').length;
    // Doc 8.4: the summary reads "X of Y files reviewed, Z annotations". Total
    // annotations sum the per-file counts the store already tracks (reading
    // annotationCounts here also makes the effect re-run as comments change).
    const annotations = Object.values(state.annotationCounts).reduce((a, n) => a + n, 0);
    const summary = document.getElementById('progress-summary');
    if (summary !== null) {
      summary.textContent = `${String(reviewed)} of ${String(total)} files reviewed, ${String(annotations)} annotation${annotations === 1 ? '' : 's'}`;
    }
    if (fill !== null) fill.style.width = String(total !== 0 ? (reviewed / total * 100) : 0) + '%';
  });
}
