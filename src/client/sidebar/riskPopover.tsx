import { toElement } from '../dom.js';
import type { RiskFileScore } from '../state.js';
import { riskColor } from './riskScore.js';

export function showRiskPopover(anchor: HTMLElement, score: RiskFileScore): void {
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

  const rect = anchor.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.left = String(rect.left) + 'px';
  popover.style.top = String(rect.bottom + 4) + 'px';
  popover.style.zIndex = '200';

  document.body.appendChild(popover);

  const close = (e: MouseEvent) => {
    if (!popover.contains(e.target as Node)) {
      popover.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => { document.addEventListener('click', close); }, 0);
}
