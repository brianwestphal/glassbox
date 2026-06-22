import type { SafeHtml } from 'kerfjs';

import { CATEGORIES } from '../state.js';

export function buildCategoryBadge(value: string): SafeHtml {
  const cat = CATEGORIES.find(c => c.value === value);
  return (
    <span className={`annotation-category category-${value} form-category-badge`} data-category={value}>
      {cat ? cat.label : value}
    </span>
  );
}

// The picker UI moved to `reclassifyPopup.tsx` so both the per-row
// reclassify badge and the form's category badge share a single
// implementation. `showCategoryPickerForBadge()` is the modern entry
// point for the form badge; `showReclassifyPopup()` is the entry point
// for the row badge.
export { showCategoryPicker, showCategoryPickerForBadge, showReclassifyPopup } from './reclassifyPopup.js';
