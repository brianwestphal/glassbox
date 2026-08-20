import { action } from 'kerfjs/actions';

// `action('x')` is `attr('data-action', 'x')` (kerfjs/actions) — one source of
// truth for both the JSX attribute (`.attrs`) and the delegated dispatch key
// (`.value`), consumed by `delegateActions` in `sidebar/index.tsx`.
export const ACTIONS = {
  toggleRiskScores: action('toggle-risk-scores'),
  setRiskDimension: action('set-risk-dimension'),
  selectFile: action('select-file'),
  toggleFolder: action('toggle-folder'),
  showRiskPopover: action('show-risk-popover'),
  retryAnalysis: action('retry-analysis'),
  toggleHideIdentical: action('toggle-hide-identical'),
} as const;
