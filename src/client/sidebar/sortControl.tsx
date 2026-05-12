import type { SafeHtml } from 'kerfjs';

import { IconBook, IconFolder, IconShield } from '../../icons.js';
import { aiStore } from '../stores/index.js';

const RISK_DIMENSIONS: Array<[string, string]> = [
  ['aggregate', 'Aggregate'],
  ['security', 'Security'],
  ['correctness', 'Correctness'],
  ['error-handling', 'Error Handling'],
  ['maintainability', 'Maintainability'],
  ['architecture', 'Architecture'],
  ['performance', 'Performance'],
];

export function sortControlJsx(): SafeHtml {
  const ai = aiStore.state.value;
  return (
    <div className="sort-mode-bar">
      <div className="segmented-control sort-mode-control">
        <button className={`segment sort-segment${ai.sortMode === 'folder' ? ' active' : ''}`}
          data-sort-mode="folder" title="Group by folder">
          <IconFolder />
        </button>
        <button className={`segment sort-segment${ai.sortMode === 'risk' ? ' active' : ''}`}
          data-sort-mode="risk" title="Sort by risk">
          <IconShield />
        </button>
        <button className={`segment sort-segment${ai.sortMode === 'narrative' ? ' active' : ''}`}
          data-sort-mode="narrative" title="Reading order">
          <IconBook />
        </button>
      </div>
      <div className="sort-risk-controls" style={ai.sortMode === 'risk' ? '' : 'display:none'}>
        <button className={`toolbar-btn sort-risk-toggle${ai.showRiskScores ? ' active' : ''}`}
          data-action="toggle-risk-scores" title="Show risk scores">
          Score
        </button>
        <select className="sort-dimension-select" data-action="set-risk-dimension">
          {RISK_DIMENSIONS.map(([value, label]) => (
            <option value={value}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
