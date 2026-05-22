import { delegate, morph } from 'kerfjs';

import type { AnnotationCategory } from '../../api/index.js';
import { updateAnnotation } from '../../api/index.js';
import { toElement } from '../dom.js';
import type { Annotation } from '../state.js';
import { CATEGORIES } from '../state.js';
import {
  editFormSignal,
  setEditForm,
} from '../stores/index.js';
import { buildAnnotationItemHtml } from './render.js';

function renderPopup(activeCategory: string): HTMLElement {
  return toElement(
    <div className="reclassify-popup" style="z-index:1000">
      {CATEGORIES.map(c => (
        <div className={`reclassify-option${c.value === activeCategory ? ' active' : ''}`} data-value={c.value}>
          <span className={`annotation-category category-${c.value}`}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

function positionPopup(popup: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.left = `${String(rect.left)}px`;
  popup.style.top = `${String(rect.bottom + 4)}px`;
}

function dismissExistingPopups(): void {
  document.querySelectorAll('.reclassify-popup').forEach(el => { el.remove(); });
}

function registerOutsideClickDismiss(popup: HTMLElement): void {
  // The popup is a transient document-body overlay and never lives inside a
  // mount() tree, so a direct `document.addEventListener` is stable here (and
  // is removed when the popup closes). Inside a mount() tree we'd use
  // delegate() instead, because re-renders would silently drop per-element
  // listeners.
  const close = (e: Event) => {
    if (!popup.contains(e.target as Node)) {
      popup.remove();
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => { document.addEventListener('click', close, true); }, 0);
}

/** Picker for an existing annotation row — saves via PATCH and updates the
 *  row's DOM in place. Used by the per-row reclassify badge. */
export function showReclassifyPopup(anchor: HTMLElement, item: HTMLElement, annotation: Annotation): void {
  dismissExistingPopups();
  const popup = renderPopup(annotation.category);
  positionPopup(popup, anchor);
  document.body.appendChild(popup);

  delegate(popup, 'click', '.reclassify-option', (e, opt) => {
    e.stopPropagation();
    const newCategory = (opt as HTMLElement).dataset.value ?? '';
    if (newCategory === annotation.category) {
      popup.remove();
      return;
    }
    void (async () => {
      await updateAnnotation({
        id: annotation.id,
        content: annotation.content,
        category: newCategory as AnnotationCategory,
      });
      const updated: Annotation = { ...annotation, category: newCategory };
      morph(item, buildAnnotationItemHtml(updated));
      popup.remove();
    })();
  });

  registerOutsideClickDismiss(popup);
}

/** Picker for the create / edit form's category badge — writes the chosen
 *  category into the edit-form signal AND the badge DOM so a subsequent save
 *  reads the right category from the signal. */
export function showCategoryPickerForBadge(badge: HTMLElement): void {
  dismissExistingPopups();
  const current = badge.dataset.category ?? '';
  const popup = renderPopup(current);
  positionPopup(popup, badge);
  document.body.appendChild(popup);

  delegate(popup, 'click', '.reclassify-option', (e, opt) => {
    e.stopPropagation();
    const value = (opt as HTMLElement).dataset.value ?? '';
    const cat = CATEGORIES.find(c => c.value === value);
    badge.className = `annotation-category category-${value} form-category-badge`;
    badge.dataset.category = value;
    badge.textContent = cat ? cat.label : value;
    if (editFormSignal.value !== null) {
      setEditForm({ ...editFormSignal.value, category: value });
    }
    popup.remove();
  });

  registerOutsideClickDismiss(popup);
}
