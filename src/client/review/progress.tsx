import { toElement } from '../dom.js';
import { state } from '../state.js';

export function updateProgress() {
  const total = state.files.length;
  const reviewed = state.files.filter(f => f.status === 'reviewed').length;
  const summary = document.getElementById('progress-summary');
  if (summary !== null) summary.textContent = `${String(reviewed)} of ${String(total)} files reviewed`;

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
  if (fill !== null) fill.style.width = String(total !== 0 ? (reviewed / total * 100) : 0) + '%';
}
