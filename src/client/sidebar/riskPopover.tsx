import { toElement } from '../dom.js';
import { dismissOnOutsideClick, positionBelowAnchor } from '../popup.js';
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

  positionBelowAnchor(popover, anchor);
  document.body.appendChild(popover);
  dismissOnOutsideClick(popover);
}
