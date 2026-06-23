import type { GroundTruthMeta } from '../../api/files.js';
import type { ReviewFile } from '../state.js';

/**
 * Ground-truth source-list grouping (doc 26 §26.3 FR-26.10/26.11, P3b). Turns a
 * flat list of review files into ordered source-list items: singles render as a
 * row, sets render as a named group of ordered step rows. Both are sorted
 * most-different-first — singles by their own perceptual score, sets by their
 * aggregate (the **max** of their steps' scores, matching the risk-aggregate
 * convention; the worst step drives triage). Within a set, steps keep their
 * declared order (`stepIndex`).
 *
 * Pure (takes the meta lookup as a parameter) so it is shared by the sidebar
 * render and the keyboard-nav order, and unit-testable without the store.
 */

export interface GroundTruthSingleItem {
  type: 'single';
  file: ReviewFile;
  score: number | null;
}

export interface GroundTruthSetItem {
  type: 'set';
  setIndex: number;
  label: string;
  /** Max of the steps' scores; null when no step is scored. */
  aggregate: number | null;
  /** Steps in declared order. */
  steps: ReviewFile[];
}

export type GroundTruthSourceItem = GroundTruthSingleItem | GroundTruthSetItem;

const scoreOf = (item: GroundTruthSourceItem): number =>
  (item.type === 'single' ? item.score : item.aggregate) ?? -1;

const sortKeyOf = (item: GroundTruthSourceItem): string =>
  item.type === 'single' ? item.file.file_path : item.label;

export function buildGroundTruthSourceList(
  files: ReviewFile[],
  metaOf: (id: string) => GroundTruthMeta | undefined,
): GroundTruthSourceItem[] {
  const singles: GroundTruthSingleItem[] = [];
  const sets = new Map<number, { label: string; steps: { file: ReviewFile; stepIndex: number }[] }>();

  for (const f of files) {
    const meta = metaOf(f.id);
    if (meta?.setIndex === undefined) {
      singles.push({ type: 'single', file: f, score: f.difference_score ?? null });
      continue;
    }
    let group = sets.get(meta.setIndex);
    if (group === undefined) {
      group = { label: meta.setLabel ?? '', steps: [] };
      sets.set(meta.setIndex, group);
    }
    // Keep the first non-empty set label we see for the group header.
    if (group.label === '' && meta.setLabel !== undefined) group.label = meta.setLabel;
    group.steps.push({ file: f, stepIndex: meta.stepIndex ?? 0 });
  }

  const setItems: GroundTruthSetItem[] = [...sets.entries()].map(([setIndex, group]) => {
    const steps = group.steps.slice().sort((a, b) => a.stepIndex - b.stepIndex).map(s => s.file);
    const scores = steps
      .map(s => s.difference_score)
      .filter((s): s is number => s !== null && s !== undefined);
    const aggregate = scores.length > 0 ? Math.max(...scores) : null;
    const label = group.label !== '' ? group.label : (steps[0]?.file_path.split('/').pop() ?? `Set ${String(setIndex + 1)}`);
    return { type: 'set', setIndex, label, aggregate, steps };
  });

  const items: GroundTruthSourceItem[] = [...singles, ...setItems];
  items.sort((a, b) => scoreOf(b) - scoreOf(a) || sortKeyOf(a).localeCompare(sortKeyOf(b)));
  return items;
}

/** Flatten the ordered source items to a review-file-id list (a set contributes
 *  its steps consecutively, in order). Used for keyboard-nav order so steps of a
 *  flow are walked together (doc 26 §26.3 FR-26.12). */
export function groundTruthFileOrder(items: GroundTruthSourceItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.type === 'single') ids.push(item.file.id);
    else for (const step of item.steps) ids.push(step.id);
  }
  return ids;
}
