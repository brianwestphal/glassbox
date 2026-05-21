import { attr } from 'kerfjs';

export const ACTIONS = {
  toggleRiskScores: attr('data-action', 'toggle-risk-scores'),
  setRiskDimension: attr('data-action', 'set-risk-dimension'),
  selectFile: attr('data-action', 'select-file'),
  toggleFolder: attr('data-action', 'toggle-folder'),
  showRiskPopover: attr('data-action', 'show-risk-popover'),
  retryAnalysis: attr('data-action', 'retry-analysis'),
} as const;
