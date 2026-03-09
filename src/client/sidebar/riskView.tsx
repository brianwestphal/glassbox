import { selectFile } from '../diff/selection.js';
import { toElement } from '../dom.js';
import type { RiskFileScore } from '../state.js';
import { state } from '../state.js';

function riskColor(score: number): string {
  if (score >= 0.7) return 'var(--red)';
  if (score >= 0.5) return 'var(--orange)';
  if (score >= 0.3) return 'var(--yellow)';
  return 'var(--green)';
}

function riskClass(score: number): string {
  if (score >= 0.7) return 'risk-critical';
  if (score >= 0.5) return 'risk-high';
  if (score >= 0.3) return 'risk-medium';
  return 'risk-low';
}

function getScoreForDimension(score: RiskFileScore, dimension: string): number {
  if (dimension === 'aggregate') return score.aggregateScore;
  return score.dimensionScores[dimension] ?? 0;
}

export function renderRiskFileList(container: Element) {
  const scores = state.riskScores;
  if (scores === null) return;

  const dimension = state.riskSortDimension;

  // Sort by selected dimension
  const sorted = scores.slice().sort((a, b) => {
    return getScoreForDimension(b, dimension) - getScoreForDimension(a, dimension);
  });

  // Apply filter
  const filtered = state.filterText !== ''
    ? sorted.filter(s => s.filePath.toLowerCase().includes(state.filterText.toLowerCase()))
    : sorted;

  state.fileOrder = [];

  for (const score of filtered) {
    const file = state.files.find(f => f.id === score.reviewFileId);
    if (file === undefined) continue;

    const displayScore = getScoreForDimension(score, dimension);
    const fileName = score.filePath.split('/').pop() ?? '';
    const count = state.annotationCounts[score.reviewFileId] ?? 0;
    const staleCount = state.staleCounts[score.reviewFileId] ?? 0;

    const el = toElement(
      <div className={`file-item${score.reviewFileId === state.currentFileId ? ' active' : ''}`}
        data-file-id={score.reviewFileId} style="padding-left: 16px">
        {state.showRiskScores && (
          <span className={`risk-badge ${riskClass(displayScore)}`}
            style={`color: ${riskColor(displayScore)}`}
            title={score.rationale}>
            {displayScore.toFixed(2)}
          </span>
        )}
        <span className="file-name" title={score.filePath}>{fileName}</span>
        <span className="file-path-dim" title={score.filePath}>
          {score.filePath.includes('/') ? score.filePath.slice(0, score.filePath.lastIndexOf('/')) : ''}
        </span>
        {staleCount > 0 ? <span className="stale-dot"></span> : null}
        {count > 0 ? <span className="annotation-count">{count}</span> : null}
      </div>
    );

    el.addEventListener('click', () => { void selectFile(score.reviewFileId); });

    // Risk popover on badge click
    const badge = el.querySelector('.risk-badge');
    if (badge !== null) {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        showRiskPopover(badge as HTMLElement, score);
      });
    }

    container.appendChild(el);
    state.fileOrder.push(score.reviewFileId);
  }
}

function showRiskPopover(anchor: HTMLElement, score: RiskFileScore) {
  // Remove any existing popover
  document.querySelectorAll('.risk-popover').forEach(p => { p.remove(); });

  const dimensions = Object.entries(score.dimensionScores);
  const popover = toElement(
    <div className="risk-popover">
      <div className="risk-popover-header">Risk Assessment</div>
      <div className="risk-popover-dimensions">
        {dimensions.map(([dim, val]) => (
          <div className="risk-dimension-row">
            <span className="risk-dimension-label">{dim}</span>
            <div className="risk-dimension-bar-track">
              <div className="risk-dimension-bar-fill"
                style={`width: ${String(Math.round(val * 100))}%; background: ${riskColor(val)}`}></div>
            </div>
            <span className="risk-dimension-value" style={`color: ${riskColor(val)}`}>
              {val.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      {score.rationale !== '' && (
        <div className="risk-popover-rationale">{score.rationale}</div>
      )}
    </div>
  );

  // Position below the anchor
  const rect = anchor.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.left = String(rect.left) + 'px';
  popover.style.top = String(rect.bottom + 4) + 'px';
  popover.style.zIndex = '200';

  document.body.appendChild(popover);

  // Close on click outside
  const close = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) {
      popover.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => { document.addEventListener('click', close); }, 0);
}
