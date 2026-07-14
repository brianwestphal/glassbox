/**
 * Pure selection math for plugin segmented-controls (doc 30 FR-30.3). DOM-free so
 * it can be unit-tested. The persisted `value` is a bare segment id (single-select
 * modes) or a JSON array of ids (multi-select modes).
 */
export type SelectionMode = 'zero-or-one' | 'exactly-one' | 'zero-or-more' | 'one-or-more';

const MODES: readonly SelectionMode[] = ['zero-or-one', 'exactly-one', 'zero-or-more', 'one-or-more'];

/** Narrow an arbitrary string to a known selection mode, defaulting to exactly-one. */
export function asSelectionMode(mode: string | undefined): SelectionMode {
  return MODES.includes(mode as SelectionMode) ? (mode as SelectionMode) : 'exactly-one';
}

/** Parse a persisted value into selected segment ids: a JSON array (multi) or a
 *  bare id (single); empty / unparseable → []. */
export function parseSelection(value: string | undefined): string[] {
  if (value === undefined || value === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch { /* not JSON — treat as a single bare id */ }
  return [value];
}

/** The selection after clicking `clicked`, honoring the mode's cardinality. */
export function nextSelection(mode: SelectionMode, current: string[], clicked: string): string[] {
  const has = current.includes(clicked);
  switch (mode) {
    case 'exactly-one':
      return [clicked]; // always exactly the clicked segment
    case 'zero-or-one':
      return has ? [] : [clicked]; // single-select toggle
    case 'zero-or-more':
      return has ? current.filter((x) => x !== clicked) : [...current, clicked];
    case 'one-or-more':
      // Toggle, but never drop below one selected.
      if (has) return current.length === 1 ? current : current.filter((x) => x !== clicked);
      return [...current, clicked];
  }
}

/** Encode a selection back to the wire value: single modes → the id (or ''),
 *  multi modes → a JSON array string. */
export function encodeSelection(mode: SelectionMode, selection: string[]): string {
  if (mode === 'exactly-one' || mode === 'zero-or-one') return selection[0] ?? '';
  return JSON.stringify(selection);
}
