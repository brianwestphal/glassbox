import { raw } from '../../jsx-runtime.js';
import { CATEGORIES } from '../state.js';
import { toElement } from '../dom.js';

export function buildCategoryBadge(value: string): string {
  const cat = CATEGORIES.find(c => c.value === value);
  return (
    <span className={`annotation-category category-${value} form-category-badge`} data-category={value}>
      {cat ? cat.label : value}
    </span>
  ).toString();
}

export function bindCategoryBadgeClick(container: Element) {
  const badge = container.querySelector('.form-category-badge') as HTMLElement | null;
  if (!badge) return;
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    showCategoryPicker(badge);
  });
}

export function showCategoryPicker(badge: HTMLElement) {
  document.querySelectorAll('.reclassify-popup').forEach(el => el.remove());

  const current = badge.dataset.category;
  const rect = badge.getBoundingClientRect();
  const optionsHtml = CATEGORIES.map(c => (
    <div className={`reclassify-option${c.value === current ? ' active' : ''}`} data-value={c.value}>
      <span className={`annotation-category category-${c.value}`}>{c.label}</span>
    </div>
  ).toString()).join('');
  const popup = toElement(
    <div className="reclassify-popup" style={`position:fixed;left:${rect.left}px;top:${rect.bottom + 4}px;z-index:1000`}>
      {raw(optionsHtml)}
    </div>
  );

  popup.addEventListener('click', (e) => {
    const opt = (e.target as HTMLElement).closest('.reclassify-option') as HTMLElement | null;
    if (!opt) return;
    e.stopPropagation();
    const val = opt.dataset.value!;
    const cat = CATEGORIES.find(c => c.value === val);
    badge.className = 'annotation-category category-' + val + ' form-category-badge';
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
  setTimeout(() => document.addEventListener('click', closePopup, true), 0);
}
