import type { SafeHtml } from 'kerfjs';

import { toElement } from '../dom.js';
import { CATEGORIES } from '../state.js';

export function buildCategoryBadge(value: string): SafeHtml {
  const cat = CATEGORIES.find(c => c.value === value);
  return (
    <span className={`annotation-category category-${value} form-category-badge`} data-category={value}>
      {cat ? cat.label : value}
    </span>
  );
}

export function bindCategoryBadgeClick(container: Element) {
  const badge = container.querySelector<HTMLElement>('.form-category-badge');
  if (!badge) return;
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    showCategoryPicker(badge);
  });
}

export function showCategoryPicker(badge: HTMLElement) {
  document.querySelectorAll('.reclassify-popup').forEach(el => { el.remove(); });

  const current = badge.dataset.category;
  const rect = badge.getBoundingClientRect();
  const popup = toElement(
    <div className="reclassify-popup" style={`position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;z-index:1000`}>
      {CATEGORIES.map(c => (
        <div className={`reclassify-option${c.value === current ? ' active' : ''}`} data-value={c.value}>
          <span className={`annotation-category category-${c.value}`}>{c.label}</span>
        </div>
      ))}
    </div>
  );

  popup.addEventListener('click', (e) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>('.reclassify-option');
    if (!opt) return;
    e.stopPropagation();
    const val = opt.dataset.value ?? '';
    const cat = CATEGORIES.find(c => c.value === val);
    badge.className = `annotation-category category-${val} form-category-badge`;
    badge.dataset.category = val;
    badge.textContent = cat ? cat.label : val;
    popup.remove();
  });

  document.body.appendChild(popup);
  const closePopup = (e: Event) => {
    if (!popup.contains(e.target as Node)) {
      popup.remove();
      document.removeEventListener('click', closePopup, true);
    }
  };
  setTimeout(() => { document.addEventListener('click', closePopup, true); }, 0);
}
