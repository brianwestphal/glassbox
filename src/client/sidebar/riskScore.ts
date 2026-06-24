/**
 * Shared risk-score → presentation mappings for the sidebar risk view and the
 * per-file risk popover. The 0.3 / 0.5 / 0.7 thresholds define the low / medium
 * / high / critical bands and must stay in lockstep across both surfaces.
 */

/** A CSS color (theme variable) for a 0..1 risk score. */
export function riskColor(score: number): string {
  if (score >= 0.7) return 'var(--red)';
  if (score >= 0.5) return 'var(--orange)';
  if (score >= 0.3) return 'var(--yellow)';
  return 'var(--green)';
}

/** A `risk-*` CSS class name for a 0..1 risk score. */
export function riskClass(score: number): string {
  if (score >= 0.7) return 'risk-critical';
  if (score >= 0.5) return 'risk-high';
  if (score >= 0.3) return 'risk-medium';
  return 'risk-low';
}
