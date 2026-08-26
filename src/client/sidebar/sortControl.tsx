import type { SafeHtml } from 'kerfjs';

import { IconBook, IconFolder, IconShield } from '../../icons.js';
import { aiStore } from '../stores/index.js';
import { ACTIONS } from './actions.js';

const RISK_DIMENSIONS: Array<[string, string]> = [
  ['aggregate', 'Overall'], // GB-1174: plainer than "Aggregate" (value unchanged)
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
        {/* Icon-only controls: aria-label gives assistive tech an explicit
            accessible name matching the tooltip (GB-1182). */}
        <button className={`segment sort-segment${ai.sortMode === 'folder' ? ' active' : ''}`}
          data-sort-mode="folder" title="Group by folder" aria-label="Group files by folder">
          <IconFolder />
        </button>
        <button className={`segment sort-segment${ai.sortMode === 'risk' ? ' active' : ''}`}
          data-sort-mode="risk" title="Sort by risk" aria-label="Sort files by AI risk score">
          <IconShield />
        </button>
        <button className={`segment sort-segment${ai.sortMode === 'narrative' ? ' active' : ''}`}
          data-sort-mode="narrative" title="Reading order" aria-label="Sort files in narrative reading order">
          <IconBook />
        </button>
      </div>
      <div className="sort-risk-controls" style={ai.sortMode === 'risk' ? '' : 'display:none'}>
        <button className={`toolbar-btn sort-risk-toggle${ai.showRiskScores ? ' active' : ''}`}
          {...ACTIONS.toggleRiskScores.attrs} title="Show risk scores">
          Score
        </button>
        <select className="sort-dimension-select" aria-label="Risk dimension to sort by" {...ACTIONS.setRiskDimension.attrs}>
          {RISK_DIMENSIONS.map(([value, label]) => (
            <option value={value} selected={value === ai.riskSortDimension}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
