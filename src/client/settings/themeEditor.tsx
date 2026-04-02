import { api } from '../api.js';
import { toElement } from '../dom.js';
import { applyThemeColors } from '../themes.js';

interface ThemeData {
  id: string;
  name: string;
  builtIn: boolean;
  baseTheme?: string;
  colors: Record<string, string>;
}

/** Color variable groups for the editor UI. */
const COLOR_GROUPS: Array<{ label: string; vars: Array<[string, string]> }> = [
  { label: 'Backgrounds', vars: [
    ['bg', 'Main background'],
    ['bg-surface', 'Surface (cards, panels)'],
    ['bg-hover', 'Hover state'],
    ['bg-active', 'Active/selected state'],
  ]},
  { label: 'Text', vars: [
    ['text', 'Primary text'],
    ['text-dim', 'Secondary text'],
    ['text-bright', 'Emphasized text'],
  ]},
  { label: 'Accent', vars: [
    ['accent', 'Primary accent'],
    ['accent-hover', 'Accent hover'],
  ]},
  { label: 'Semantic Colors', vars: [
    ['green', 'Green / Success'],
    ['red', 'Red / Error'],
    ['yellow', 'Yellow / Warning'],
    ['orange', 'Orange'],
    ['blue', 'Blue'],
    ['purple', 'Purple'],
    ['teal', 'Teal'],
  ]},
  { label: 'Border', vars: [
    ['border', 'Default border'],
  ]},
  { label: 'Diff', vars: [
    ['diff-add-bg', 'Added line background'],
    ['diff-add-border', 'Added line border'],
    ['diff-remove-bg', 'Removed line background'],
    ['diff-remove-border', 'Removed line border'],
  ]},
  { label: 'Gutter', vars: [
    ['gutter-bg', 'Gutter background'],
    ['gutter-text', 'Gutter text'],
  ]},
];

/**
 * Show the theme color editor for a given theme.
 * For built-in themes, auto-copies to a "(Customized)" version on first edit.
 */
export function showThemeEditor(themeId: string, onDone?: () => void) {
  void (async () => {
    const listData = await api<{ themes: ThemeData[]; activeId: string }>('/themes');
    let theme = listData.themes.find(t => t.id === themeId);
    if (!theme) return;

    // Resolve base theme colors for Reset functionality
    const baseThemeId = theme.builtIn ? theme.id : (theme.baseTheme ?? 'dark');
    const baseTheme = listData.themes.find(t => t.id === baseThemeId);
    const baseColors = baseTheme ? { ...baseTheme.colors } : { ...theme.colors };

    const editColors = { ...theme.colors };
    let editName = theme.name;
    let dirty = false;
    let currentThemeId = themeId;

    const overlay = toElement(<div className="modal-overlay"></div>);

    function close() {
      document.removeEventListener('keydown', handleEscape);
      if (dirty) void save();
      overlay.remove();
      if (onDone) onDone();
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }

    async function save() {
      if (!dirty) return;
      const body: Record<string, unknown> = { colors: editColors };
      // Include name if it changed from the original
      if (theme !== undefined && editName !== theme.name) body.name = editName;
      const result = await api<{ theme: ThemeData; copied: boolean }>(`/themes/${currentThemeId}/edit`, {
        method: 'POST',
        body,
      });
      if (result.copied) {
        currentThemeId = result.theme.id;
        theme = result.theme;
      }
      dirty = false;
    }

    function applyLive() {
      applyThemeColors(editColors);
    }

    function toHex(color: string): string {
      if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
      const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const r = parseInt(m[1]).toString(16).padStart(2, '0');
        const g = parseInt(m[2]).toString(16).padStart(2, '0');
        const b = parseInt(m[3]).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
      }
      return '#888888';
    }

    function render() {
      const modalEl = overlay.querySelector('.modal');
      if (!modalEl) return;

      const isBuiltIn = theme?.builtIn === true;
      const headerText = isBuiltIn ? 'Edit Theme (will create a copy)' : 'Edit Theme';

      modalEl.innerHTML = (
        <>
          <div className="settings-header">
            <h3>{headerText}</h3>
            <button className="settings-close" id="te-close">&times;</button>
          </div>
          <div className="theme-editor-body">
            {!isBuiltIn && (
              <div className="theme-editor-name-section">
                <label className="settings-label">Name</label>
                <input type="text" className="settings-input" id="te-name" value={editName} />
              </div>
            )}
            <div className="theme-editor-toolbar">
              <button className="btn btn-sm" id="te-reset-all">Reset All to Base</button>
            </div>
            {COLOR_GROUPS.map(group => (
              <div className="theme-editor-group">
                <h4 className="theme-editor-group-label">{group.label}</h4>
                {group.vars.map(([varName, label]) => (
                  <div className="theme-editor-row" data-var={varName}>
                    <span className="theme-editor-label">{label}</span>
                    <span className="theme-editor-swatch" style={`background:${editColors[varName] ?? '#888'}`}></span>
                    <input type="color" className="theme-editor-picker" value={toHex(editColors[varName] ?? '#888888')} data-var={varName} />
                    <input type="text" className="theme-editor-hex" value={editColors[varName] ?? ''} data-var={varName} />
                    <button className="btn btn-xs theme-editor-reset" data-var={varName} title="Reset to base">&#x21ba;</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      ).toString();

      bindEvents();
    }

    function updateColor(varName: string, value: string) {
      editColors[varName] = value;
      dirty = true;
      applyLive();
      const row = overlay.querySelector(`[data-var="${varName}"].theme-editor-row`);
      if (row) {
        const swatch = row.querySelector<HTMLElement>('.theme-editor-swatch');
        if (swatch) swatch.style.background = value;
        const picker = row.querySelector<HTMLInputElement>('.theme-editor-picker');
        if (picker && document.activeElement !== picker) picker.value = toHex(value);
        const hex = row.querySelector<HTMLInputElement>('.theme-editor-hex');
        if (hex && document.activeElement !== hex) hex.value = value;
      }
    }

    function bindEvents() {
      overlay.querySelector('#te-close')?.addEventListener('click', close);

      // Name input
      const nameInput = overlay.querySelector<HTMLInputElement>('#te-name');
      if (nameInput) {
        nameInput.addEventListener('input', () => {
          editName = nameInput.value;
          dirty = true;
        });
      }

      // Color pickers
      overlay.querySelectorAll('.theme-editor-picker').forEach(picker => {
        picker.addEventListener('input', () => {
          const varName = (picker as HTMLElement).dataset.var ?? '';
          updateColor(varName, (picker as HTMLInputElement).value);
        });
      });

      // Hex text inputs
      overlay.querySelectorAll('.theme-editor-hex').forEach(input => {
        input.addEventListener('change', () => {
          const varName = (input as HTMLElement).dataset.var ?? '';
          const value = (input as HTMLInputElement).value.trim();
          if (value !== '') updateColor(varName, value);
        });
      });

      // Per-color reset
      overlay.querySelectorAll('.theme-editor-reset').forEach(btn => {
        btn.addEventListener('click', () => {
          const varName = (btn as HTMLElement).dataset.var ?? '';
          const baseValue = baseColors[varName];
          if (baseValue !== '') updateColor(varName, baseValue);
        });
      });

      // Reset All
      overlay.querySelector('#te-reset-all')?.addEventListener('click', () => {
        for (const [key, value] of Object.entries(baseColors)) {
          editColors[key] = value;
        }
        dirty = true;
        applyLive();
        render();
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
    }

    document.addEventListener('keydown', handleEscape);
    overlay.innerHTML = (<div className="modal settings-dialog theme-editor-dialog"></div>).toString();
    document.body.appendChild(overlay);
    render();
  })();
}
