import { toElement } from '../dom.js';
import { state } from '../state.js';

const AUDIENCES = [
  { id: 'self', label: 'For myself', description: 'Understand the changes in a narrative, visual way' },
  { id: 'team', label: 'For my team', description: 'Technical walkthrough of what changed and why' },
  { id: 'leadership', label: 'For leadership', description: 'Business impact, risks, and strategic implications' },
  { id: 'stakeholders', label: 'For stakeholders', description: 'Project update with context and next steps' },
];

/**
 * Show the audience selector before generating a presentation.
 * Returns a promise that resolves with the selected audience ID, or null if cancelled.
 */
export function showAudienceSelector(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = toElement(<div className="modal-overlay"></div>);

    const modal = toElement(
      <div className="modal audience-selector">
        <h3>Who is this presentation for?</h3>
        <div className="audience-options">
          {AUDIENCES.map(a => (
            <button className="audience-option" data-audience={a.id}>
              <span className="audience-option-label">{a.label}</span>
              <span className="audience-option-desc">{a.description}</span>
            </button>
          ))}
        </div>
      </div>
    );

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Bind click handlers
    modal.querySelectorAll('.audience-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const audience = (btn as HTMLElement).dataset.audience ?? null;
        state.presentationAudience = audience;
        overlay.remove();
        resolve(audience);
      });
    });

    // Click outside or Escape to cancel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handleEscape); resolve(null); }
    };
    document.addEventListener('keydown', handleEscape);
  });
}
