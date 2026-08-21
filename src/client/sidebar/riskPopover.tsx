import { toElement } from '../dom.js';
import { dismissOnOutsideClick, positionAnchoredPopup } from '../popup.js';
import type { RiskFileScore } from '../state.js';
import { riskColor } from './riskScore.js';

// The single currently-open risk popover's dismiss fn (removes the element,
// its outside-click listener, AND the autoReposition scroll/resize listeners).
// Reopening dismisses the previous one through here so nothing leaks — a bare
// `.remove()` would strand the reposition listeners.
let activeDismiss: (() => void) | null = null;

export function showRiskPopover(anchor: HTMLElement, score: RiskFileScore): void {
  activeDismiss?.();

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

  const stopReposition = positionAnchoredPopup(popover, anchor);
  document.body.appendChild(popover);
  activeDismiss = dismissOnOutsideClick(popover, () => {
    stopReposition();
    activeDismiss = null;
  });
}
