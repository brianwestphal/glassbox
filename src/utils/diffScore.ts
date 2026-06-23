/**
 * Formatting helpers for the ground-truth perceptual difference score (doc 26
 * P2). The score is a fraction in [0,1] (share of changed pixels). Shared by the
 * server-rendered diff header and the client sidebar so both read identically.
 */

/** A compact percentage label, e.g. `0%`, `0.3%`, `12%`. Sub-1% keeps a decimal
 *  so a small-but-real difference doesn't round away to `0%`. */
export function formatDiffPct(score: number): string {
  const pct = score * 100;
  if (pct === 0) return '0%';
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/** Coarse severity bucket for color-coding a score badge. */
export function diffScoreLevel(score: number): 'none' | 'low' | 'medium' | 'high' {
  if (score === 0) return 'none';
  if (score < 0.02) return 'low';
  if (score < 0.1) return 'medium';
  return 'high';
}
