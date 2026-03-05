import { state } from '../state.js';
import { toElement } from '../dom.js';

export function updateProgress() {
  const total = state.files.length;
  const reviewed = state.files.filter(f => f.status === 'reviewed').length;
  const summary = document.getElementById('progress-summary');
  if (summary) summary.textContent = reviewed + ' of ' + total + ' files reviewed';

  let bar = document.querySelector('.progress-bar') as HTMLElement | null;
  if (!bar) {
    bar = toElement(
      <div className="progress-bar">
        <div className="progress-bar-fill"></div>
      </div>
    );
    const controls = document.querySelector('.sidebar-controls');
    if (controls) controls.appendChild(bar);
  }
  const fill = bar.querySelector('.progress-bar-fill') as HTMLElement | null;
  if (fill) fill.style.width = (total ? (reviewed / total * 100) : 0) + '%';
}
