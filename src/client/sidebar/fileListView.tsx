import type { SafeHtml } from 'kerfjs';
import { raw } from 'kerfjs';

import { parseDiffData } from '../../git/parseDiffData.js';
import { EXPECTED_KIND_LABELS } from '../../ground-truth/presentation.js';
import { IconChevronDown } from '../../icons.js';
import { diffScoreLevel, formatDiffPct } from '../../utils/diffScore.js';
import type { AnalysisModeState, NarrativeFileOrder, RiskFileScore } from '../state.js';
import {
  aiStore,
  diffViewStore,
  folderModeFiles,
  groundTruthMeta,
  hasIdenticalFiles,
  isGroundTruthReview,
  reviewStore,
  sortedNarrativeOrder,
  sortedRiskScores,
  unscoredFiles,
} from '../stores/index.js';
import { ACTIONS } from './actions.js';
import { buildFolderTree, sortFilesByScore, type TreeNode } from './folderTree.js';
import { buildGroundTruthSourceList, type GroundTruthSetItem } from './groundTruthGroups.js';

export function fileListJsx(): SafeHtml {
  const ai = aiStore.state.value;
  const banner = analysisBannerJsx(ai);

  if (ai.sortMode === 'risk') {
    return <>{banner}{riskListJsx()}</>;
  }
  if (ai.sortMode === 'narrative') {
    return <>{banner}{narrativeListJsx()}</>;
  }
  return <>{banner}{folderListJsx()}</>;
}

function analysisBannerJsx(ai: typeof aiStore.state.value): SafeHtml {
  const banners: SafeHtml[] = [];
  if (ai.sortMode === 'risk' && ai.riskAnalysis.status === 'running') {
    banners.push(progressBarJsx(ai.riskAnalysis, 'Analyzing risk'));
  } else if (ai.sortMode === 'narrative' && ai.narrativeAnalysis.status === 'running') {
    banners.push(progressBarJsx(ai.narrativeAnalysis, 'Analyzing reading order'));
  }
  if (ai.guidedReviewEnabled && ai.guidedAnalysis.status === 'running') {
    banners.push(progressBarJsx(ai.guidedAnalysis, 'Guided review'));
  }
  if (ai.sortMode === 'risk' && ai.riskAnalysis.status === 'failed') {
    banners.push(analysisErrorJsx(ai.riskAnalysis.error, 'risk'));
  } else if (ai.sortMode === 'narrative' && ai.narrativeAnalysis.status === 'failed') {
    banners.push(analysisErrorJsx(ai.narrativeAnalysis.error, 'narrative'));
  }
  if (banners.length === 0) return raw('');
  return <>{banners}</>;
}

function progressBarJsx(modeState: AnalysisModeState, label: string): SafeHtml {
  const completed = modeState.progressCompleted;
  const total = modeState.progressTotal;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const text = total > 0 ? `${label}... ${String(completed)}/${String(total)}` : `${label}...`;
  return (
    <div className="analysis-loading-inline">
      <div className="analysis-spinner analysis-spinner-sm"></div>
      <div className="analysis-progress-info">
        <span>{text}</span>
        {total > 0 && (
          <div className="analysis-progress-bar">
            <div className="analysis-progress-fill" style={`width: ${String(pct)}%`}></div>
          </div>
        )}
      </div>
    </div>
  );
}

function analysisErrorJsx(error: string | null, mode: 'risk' | 'narrative'): SafeHtml {
  return (
    <div className="analysis-error">
      <span>{'Analysis failed: ' + (error ?? 'Unknown error')}</span>
      <button className="btn btn-xs btn-primary" {...ACTIONS.retryAnalysis.attrs} data-mode={mode}>Retry</button>
    </div>
  );
}

// --- Risk view ---

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

function riskListJsx(): SafeHtml {
  const ai = aiStore.state.value;
  const review = reviewStore.state.value;
  const scored = sortedRiskScores();
  const scoredIds = new Set((ai.riskScores ?? []).map(s => s.reviewFileId));
  const tail = unscoredFiles(scoredIds);

  // `.map()`, not `each()` — kerf Hard Rule 13. The `RiskFileScore` /
  // `ReviewFile` items keep stable object identity across mount re-runs (they
  // come from a store array that only changes wholesale on analysis reload),
  // so `each()` here would memoize the row HTML by identity and never
  // re-invoke the row render when `riskSortDimension` / `showRiskScores` /
  // `currentFileId` / annotation counts change. `.map()` re-renders every
  // row on every mount pass — same shape kerf SKILL.md recommends for
  // "STATIC_ARRAY.map(...)" cases. Lists here are at most a few dozen rows;
  // the per-row memoization isn't worth the bug surface.
  return (
    <>
      {scored.map(score => riskRowJsx(score, ai, review))}
      {tail.map(file => flatRowJsx(file, review))}
    </>
  );
}

function riskRowJsx(
  score: RiskFileScore,
  ai: typeof aiStore.state.value,
  review: typeof reviewStore.state.value,
): SafeHtml {
  const displayScore = getScoreForDimension(score, ai.riskSortDimension);
  const fileName = score.filePath.split('/').pop() ?? '';
  const count = review.annotationCounts[score.reviewFileId] ?? 0;
  const staleCount = review.staleCounts[score.reviewFileId] ?? 0;
  const dir = score.filePath.includes('/') ? score.filePath.slice(0, score.filePath.lastIndexOf('/')) : '';
  return (
    <div data-key={score.reviewFileId}
      className={`file-item${score.reviewFileId === review.currentFileId ? ' active' : ''}`}
      {...ACTIONS.selectFile.attrs} data-file-id={score.reviewFileId} style="padding-left: 16px">
      {ai.showRiskScores && (
        <span className={`risk-badge ${riskClass(displayScore)}`}
          style={`color: ${riskColor(displayScore)}`}
          title={score.rationale}
          {...ACTIONS.showRiskPopover.attrs} data-file-id={score.reviewFileId}>
          {displayScore.toFixed(2)}
        </span>
      )}
      <span className="file-name" title={score.filePath}>{fileName}</span>
      <span className="file-path-dim" title={score.filePath}>{dir}</span>
      {staleCount > 0 ? <span className="stale-count" title={`${String(staleCount)} stale annotation${staleCount === 1 ? '' : 's'}`}>{staleCount}</span> : null}
      {count > 0 ? <span className="annotation-count">{count}</span> : null}
    </div>
  );
}

// --- Narrative view ---

function narrativeListJsx(): SafeHtml {
  const ai = aiStore.state.value;
  const review = reviewStore.state.value;
  const ordered = sortedNarrativeOrder();
  const orderedIds = new Set((ai.narrativeOrder ?? []).map(o => o.reviewFileId));
  const tail = unscoredFiles(orderedIds);

  // `.map()`, not `each()`. See note on `riskListJsx` for Rule 13 rationale.
  return (
    <>
      {ordered.map(item => narrativeRowJsx(item, review))}
      {tail.map(file => flatRowJsx(file, review))}
    </>
  );
}

function narrativeRowJsx(item: NarrativeFileOrder, review: typeof reviewStore.state.value): SafeHtml {
  const fileName = item.filePath.split('/').pop() ?? '';
  const count = review.annotationCounts[item.reviewFileId] ?? 0;
  const staleCount = review.staleCounts[item.reviewFileId] ?? 0;
  const dir = item.filePath.includes('/') ? item.filePath.slice(0, item.filePath.lastIndexOf('/')) : '';
  return (
    <div data-key={item.reviewFileId}
      className={`file-item${item.reviewFileId === review.currentFileId ? ' active' : ''}`}
      {...ACTIONS.selectFile.attrs} data-file-id={item.reviewFileId} style="padding-left: 16px">
      <span className="narrative-position" title={item.rationale}>{item.position}</span>
      <span className="file-name" title={item.filePath}>{fileName}</span>
      <span className="file-path-dim" title={item.filePath}>{dir}</span>
      {staleCount > 0 ? <span className="stale-count" title={`${String(staleCount)} stale annotation${staleCount === 1 ? '' : 's'}`}>{staleCount}</span> : null}
      {count > 0 ? <span className="annotation-count">{count}</span> : null}
    </div>
  );
}

function flatRowJsx(file: typeof reviewStore.state.value['files'][number], review: typeof reviewStore.state.value): SafeHtml {
  const fileName = file.file_path.split('/').pop() ?? '';
  const count = review.annotationCounts[file.id] ?? 0;
  const staleCount = review.staleCounts[file.id] ?? 0;
  const dir = file.file_path.includes('/') ? file.file_path.slice(0, file.file_path.lastIndexOf('/')) : '';
  return (
    <div data-key={file.id}
      className={`file-item${file.id === review.currentFileId ? ' active' : ''}`}
      {...ACTIONS.selectFile.attrs} data-file-id={file.id} style="padding-left: 16px">
      <span className="file-name" title={file.file_path}>{fileName}</span>
      <span className="file-path-dim" title={file.file_path}>{dir}</span>
      {staleCount > 0 ? <span className="stale-count" title={`${String(staleCount)} stale annotation${staleCount === 1 ? '' : 's'}`}>{staleCount}</span> : null}
      {count > 0 ? <span className="annotation-count">{count}</span> : null}
    </div>
  );
}

// --- Folder view ---

function folderListJsx(): SafeHtml {
  // Ground-truth reviews (doc 26 §26.1) read as a flat list of named
  // comparisons (label + expectedKind), not an `actual/` file tree.
  if (isGroundTruthReview()) return groundTruthListJsx();
  const tree = buildFolderTree(folderModeFiles());
  return <>{identicalToggleJsx()}{treeNodeJsx(tree, 0, '')}</>;
}

/** Ground-truth source list (doc 26 §26.1/§26.3): singles render one row per
 *  comparison; `version: 2` sets render as a collapsible named group of ordered
 *  step rows. Both sort most-different-first (sets by their max-aggregate score),
 *  captioned by the manifest label + expectedKind. */
function groundTruthListJsx(): SafeHtml {
  const review = reviewStore.state.value;
  const items = buildGroundTruthSourceList(folderModeFiles(), groundTruthMeta);
  return (
    <>
      {identicalToggleJsx()}
      {items.map(item =>
        item.type === 'single'
          ? groundTruthRowJsx(item.file, review, 16)
          : groundTruthSetJsx(item, review))}
    </>
  );
}

/** A `version: 2` set: a collapsible header (label + aggregate difference)
 *  expandable to its ordered step rows (doc 26 §26.3 FR-26.10). Reuses the
 *  folder collapse machinery (`collapsedFolders` keyed `gt-set:<i>`). */
function groundTruthSetJsx(item: GroundTruthSetItem, review: typeof reviewStore.state.value): SafeHtml {
  const collapsed = diffViewStore.state.value.collapsedFolders;
  const folderPath = `gt-set:${String(item.setIndex)}`;
  const isCollapsed = collapsed.has(folderPath);
  const score = item.aggregate;
  const hasActiveStep = item.steps.some(s => s.id === review.currentFileId);
  return (
    <div data-key={folderPath} className="folder-group gt-set">
      <div className={`folder-header collapsible gt-set-header${isCollapsed ? ' collapsed' : ''}${hasActiveStep ? ' has-active' : ''}`}
        style="padding-left: 16px" data-action="toggle-folder" data-folder-path={folderPath}>
        <span className="folder-arrow"><IconChevronDown /></span>
        <span className="folder-name gt-set-name" title={item.label}>{item.label}</span>
        {score !== null
          ? <span className={`diff-badge diff-${diffScoreLevel(score)}`} title="Worst-step perceptual difference for this set">{formatDiffPct(score)}</span>
          : null}
        <span className="gt-set-count" title={`${String(item.steps.length)} step${item.steps.length === 1 ? '' : 's'}`}>{String(item.steps.length)}</span>
      </div>
      <div className="folder-content" style={isCollapsed ? 'display:none' : ''}>
        {item.steps.map(f => groundTruthRowJsx(f, review, 28))}
      </div>
    </div>
  );
}

function groundTruthRowJsx(
  f: typeof reviewStore.state.value['files'][number],
  review: typeof reviewStore.state.value,
  padLeft: number,
): SafeHtml {
  const meta = groundTruthMeta(f.id);
  const basename = f.file_path.split('/').pop() ?? f.file_path;
  const name = meta?.label ?? basename;
  const kind = meta?.expectedKind;
  const count = review.annotationCounts[f.id] ?? 0;
  const staleCount = review.staleCounts[f.id] ?? 0;
  const score = f.difference_score;
  return (
    <div data-key={f.id}
      className={`file-item gt-comparison${f.id === review.currentFileId ? ' active' : ''}`}
      {...ACTIONS.selectFile.attrs} data-file-id={f.id} style={`padding-left: ${String(padLeft)}px`}>
      <span className="file-name" title={f.file_path}>{name}</span>
      {kind ? <span className={`gt-kind gt-kind-${kind}`} title={`Expected image is a ${EXPECTED_KIND_LABELS[kind].toLowerCase()}`}>{EXPECTED_KIND_LABELS[kind]}</span> : null}
      {score !== null && score !== undefined
        ? <span className={`diff-badge diff-${diffScoreLevel(score)}`} title="Perceptual difference from the expected image">{formatDiffPct(score)}</span>
        : null}
      {staleCount > 0 ? <span className="stale-count" title={`${String(staleCount)} stale annotation${staleCount === 1 ? '' : 's'}`}>{staleCount}</span> : null}
      {count > 0 ? <span className="annotation-count">{count}</span> : null}
    </div>
  );
}

/** Ground-truth (doc 26 P2): a toggle to reveal/hide identical (0-difference)
 *  pairs. Only shown when such pairs exist, so it never appears for git diffs. */
function identicalToggleJsx(): SafeHtml {
  if (!hasIdenticalFiles()) return raw('');
  const hidden = diffViewStore.state.value.hideIdentical;
  const count = reviewStore.state.value.files.filter(f => f.difference_score === 0).length;
  const label = hidden
    ? `Show ${String(count)} identical`
    : `Hide ${String(count)} identical`;
  return (
    <button className={`identical-toggle${hidden ? '' : ' active'}`} {...ACTIONS.toggleHideIdentical.attrs}
      title="Identical comparisons have nothing to review">
      {label}
    </button>
  );
}

function treeNodeJsx(node: TreeNode, depth: number, pathPrefix: string): SafeHtml {
  const sortedChildren = node.children.slice().sort((a, b) => a.name.localeCompare(b.name));
  const review = reviewStore.state.value;
  const collapsed = diffViewStore.state.value.collapsedFolders;
  const pad = (d: number) => `padding-left: ${String(16 + d * 12)}px`;

  return (
    <>
      {sortedChildren.map(child => {
        const folderPath = pathPrefix !== '' ? pathPrefix + '/' + child.name : child.name;
        const total = countFiles(child);
        const isCollapsible = total > 1;
        const isCollapsed = isCollapsible && collapsed.has(folderPath);
        const stale = hasStale(child, review.staleCounts);
        return (
          <div data-key={`folder:${folderPath}`} className="folder-group">
            <div className={`folder-header${isCollapsible ? ' collapsible' : ''}${isCollapsed ? ' collapsed' : ''}`}
              style={pad(depth)}
              data-action={isCollapsible ? 'toggle-folder' : undefined}
              data-folder-path={folderPath}>
              {isCollapsible
                ? <span className="folder-arrow"><IconChevronDown /></span>
                : <span className="folder-arrow-spacer"></span>}
              <span className="folder-name">{child.name}/</span>
              {stale && <span className="stale-dot"></span>}
            </div>
            <div className="folder-content" style={isCollapsed ? 'display:none' : ''}>
              {treeNodeJsx(child, depth + 1, folderPath)}
            </div>
          </div>
        );
      })}
      {sortFilesByScore(node.files).map(f => fileRowJsx(f, depth, review))}
    </>
  );
}

function fileRowJsx(f: typeof reviewStore.state.value['files'][number], depth: number, review: typeof reviewStore.state.value): SafeHtml {
  const diff = parseDiffData(f.diff_data);
  const count = review.annotationCounts[f.id] ?? 0;
  const staleCount = review.staleCounts[f.id] ?? 0;
  const fileName = f.file_path.split('/').pop() ?? '';
  const pad = `padding-left: ${String(16 + depth * 12)}px`;
  const score = f.difference_score;
  return (
    <div data-key={f.id}
      className={`file-item${f.id === review.currentFileId ? ' active' : ''}`}
      {...ACTIONS.selectFile.attrs} data-file-id={f.id} style={pad}>
      <span className={`status-dot ${f.status}`}></span>
      <span className="file-name" title={f.file_path}>{fileName}</span>
      {score !== null && score !== undefined
        ? <span className={`diff-badge diff-${diffScoreLevel(score)}`} title="Perceptual difference from the expected image">{formatDiffPct(score)}</span>
        : <span className={`file-status ${diff?.status ?? ''}`}>{diff?.status ?? ''}</span>}
      {staleCount > 0 ? <span className="stale-count" title={`${String(staleCount)} stale annotation${staleCount === 1 ? '' : 's'}`}>{staleCount}</span> : null}
      {count > 0 ? <span className="annotation-count">{count}</span> : null}
    </div>
  );
}

function countFiles(node: TreeNode): number {
  let count = node.files.length;
  for (const c of node.children) count += countFiles(c);
  return count;
}

function hasStale(node: TreeNode, staleCounts: Record<string, number>): boolean {
  for (const f of node.files) {
    if ((staleCounts[f.id] ?? 0) > 0) return true;
  }
  for (const c of node.children) {
    if (hasStale(c, staleCounts)) return true;
  }
  return false;
}
