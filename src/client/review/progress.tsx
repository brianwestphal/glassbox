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
    const files = reviewStore.state.value.files;
    const total = files.length;
    const reviewed = files.filter(f => f.status === 'reviewed').length;
    const summary = document.getElementById('progress-summary');
    if (summary !== null) summary.textContent = `${String(reviewed)} of ${String(total)} files reviewed`;
    if (fill !== null) fill.style.width = String(total !== 0 ? (reviewed / total * 100) : 0) + '%';
  });
}
