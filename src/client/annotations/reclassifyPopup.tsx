import { delegate, morph } from 'kerfjs';

import { updateAnnotation } from '../../api/index.js';
import { asEl, toElement } from '../dom.js';
import { asCategory } from '../narrow.js';
import { dismissOnOutsideClick, positionAnchoredPopup } from '../popup.js';
import type { Annotation } from '../state.js';
import { CATEGORIES } from '../state.js';
import {
  editFormSignal,
  setEditForm,
} from '../stores/index.js';
import { buildAnnotationItemHtml } from './render.js';

function renderPopup(activeCategory: string): HTMLElement {
  return toElement(
    <div className="reclassify-popup">
      {CATEGORIES.map(c => (
        <div className={`reclassify-option${c.value === activeCategory ? ' active' : ''}`} data-value={c.value}>
          <span className={`annotation-category category-${c.value}`}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// The single currently-open picker's dismiss fn (removes the element, its
// outside-click listener, AND the autoReposition scroll/resize listeners).
// Every close path — reopen, option pick, outside click — routes through it so
// nothing leaks; a bare `.remove()` would strand the reposition listeners.
let activeDismiss: (() => void) | null = null;

function dismissExistingPopups(): void {
  activeDismiss?.();
  activeDismiss = null;
  // Safety net for any untracked stray popup (defensive; the tracked dismiss
  // above handles the normal case).
  document.querySelectorAll('.reclassify-popup').forEach(el => { el.remove(); });
}

/** Generic category picker: opens the shared popup anchored to `anchor`,
 *  highlighting `current`, and invokes `onPick` with the chosen category value.
 *  The two specialized entry points below build on this, as does image feedback
 *  (doc 23). */
export function showCategoryPicker(
  anchor: HTMLElement,
  current: string,
  onPick: (value: string) => void,
): void {
  dismissExistingPopups();
  const popup = renderPopup(current);
  const stopReposition = positionAnchoredPopup(popup, anchor);
  document.body.appendChild(popup);

  const dismiss = dismissOnOutsideClick(popup, () => {
    stopReposition();
    activeDismiss = null;
  });
  activeDismiss = dismiss;

  void delegate(popup, 'click', '.reclassify-option', (e, opt) => {
    e.stopPropagation();
    const value = asEl(opt).dataset.value ?? '';
    // Route through dismiss (not a bare popup.remove()) so the reposition
    // listeners are cleaned up along with the element + outside-click listener.
    dismiss();
    onPick(value);
  });
}

/** Picker for an existing annotation row — saves via PATCH and updates the
 *  row's DOM in place. Used by the per-row reclassify badge. */
export function showReclassifyPopup(anchor: HTMLElement, item: HTMLElement, annotation: Annotation): void {
  showCategoryPicker(anchor, annotation.category, (newCategory) => {
    if (newCategory === annotation.category) return;
    void (async () => {
      await updateAnnotation({
        id: annotation.id,
        content: annotation.content,
        category: asCategory(newCategory),
      });
      const updated: Annotation = { ...annotation, category: newCategory };
      morph(item, buildAnnotationItemHtml(updated));
    })();
  });
}

/** Picker for the create / edit form's category badge — writes the chosen
 *  category into the edit-form signal AND the badge DOM so a subsequent save
 *  reads the right category from the signal. */
export function showCategoryPickerForBadge(badge: HTMLElement): void {
  const current = badge.dataset.category ?? '';
  showCategoryPicker(badge, current, (value) => {
    const cat = CATEGORIES.find(c => c.value === value);
    badge.className = `annotation-category category-${value} form-category-badge`;
    badge.dataset.category = value;
    badge.textContent = cat ? cat.label : value;
    if (editFormSignal.value !== null) {
      setEditForm({ ...editFormSignal.value, category: value });
    }
  });
}
