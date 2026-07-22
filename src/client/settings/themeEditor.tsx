import type { SafeHtml } from 'kerfjs';
import { delegate, effect, mount, signal } from 'kerfjs';

import { editTheme, listThemes } from '../../api/index.js';
import { IconX } from '../../icons.js';
import { asEl, asInput, toElement } from '../dom.js';
import { applyThemeColors } from '../themes.js';

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

function toHex(color: string): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return '#888888';
}

/**
 * Show the theme color editor for a given theme.
 * For built-in themes, auto-copies to a "(Customized)" version on first edit.
 */
export function showThemeEditor(themeId: string, onDone?: () => void): void {
  void (async () => {
    const listData = await listThemes();
    let theme = listData.themes.find(t => t.id === themeId);
    if (theme === undefined) return;
    const isBuiltIn = theme.builtIn;

    // Resolve base theme colors for Reset functionality
    const baseThemeId = theme.builtIn ? theme.id : (theme.baseTheme ?? 'dark');
    const baseTheme = listData.themes.find(t => t.id === baseThemeId);
    const baseColors: Record<string, string> = baseTheme
      ? { ...baseTheme.colors as unknown as Record<string, string> }
      : { ...theme.colors as unknown as Record<string, string> };

    // Live edit state lives in signals. The `editColorsSignal` drives both
    // the live preview (an `effect()` that pushes CSS custom properties to
    // `document.documentElement`) AND the `mount()` render of the form
    // below — every color change reactively updates both.
    const editColorsSignal = signal<Record<string, string>>({ ...theme.colors as unknown as Record<string, string> });
    const editNameSignal = signal(theme.name);
    let dirty = false;
    let currentThemeId = themeId;
    const originalName = theme.name;

    const overlay = toElement(<div className="modal-overlay"><div className="modal settings-dialog theme-editor-dialog"></div></div>);
    const modalEl = overlay.querySelector<HTMLElement>('.modal');
    if (modalEl === null) return;

    const disposeLivePreview = effect(() => {
      applyThemeColors(editColorsSignal.value);
    });

    let disposeMount: (() => void) | null = null;
    function close(): void {
      document.removeEventListener('keydown', handleEscape);
      disposeLivePreview();
      if (disposeMount !== null) disposeMount();
      if (dirty) void save();
      overlay.remove();
      if (onDone !== undefined) onDone();
    }

    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }

    async function save(): Promise<void> {
      if (!dirty) return;
      const result = await editTheme({
        id: currentThemeId,
        colors: editColorsSignal.value,
        ...(editNameSignal.value !== originalName ? { name: editNameSignal.value } : {}),
      });
      if (result.copied) {
        currentThemeId = result.theme.id;
        theme = result.theme;
      }
      dirty = false;
    }

    function updateColor(varName: string, value: string): void {
      editColorsSignal.value = { ...editColorsSignal.value, [varName]: value };
      dirty = true;
    }

    disposeMount = mount(modalEl, () => renderEditor(isBuiltIn, editNameSignal.value, editColorsSignal.value));

    // Delegated event handlers. Per-row inputs (`.theme-editor-picker`,
    // `.theme-editor-hex`) all match a single delegate selector — kerf
    // morph preserves the focused input's value and cursor across renders
    // (docs §4.4), so the picker keeps focus while another color updates.

    void delegate(overlay, 'click', '#te-close', close);

    void delegate(overlay, 'input', '#te-name', (_e, input) => {
      editNameSignal.value = asInput(input).value;
      dirty = true;
    });

    void delegate(overlay, 'input', '.theme-editor-picker', (_e, picker) => {
      const varName = asEl(picker).dataset.var ?? '';
      if (varName !== '') updateColor(varName, asInput(picker).value);
    });

    void delegate(overlay, 'change', '.theme-editor-hex', (_e, input) => {
      const varName = asEl(input).dataset.var ?? '';
      const value = asInput(input).value.trim();
      if (varName !== '' && value !== '') updateColor(varName, value);
    });

    void delegate(overlay, 'click', '.theme-editor-reset', (_e, btn) => {
      const varName = asEl(btn).dataset.var ?? '';
      const baseValue = baseColors[varName];
      if (varName !== '' && baseValue !== '') updateColor(varName, baseValue);
    });

    void delegate(overlay, 'click', '#te-reset-all', () => {
      editColorsSignal.value = { ...baseColors };
      dirty = true;
    });

    // Click-outside-to-close — direct listener on the overlay (overlay
    // isn't inside any mount() tree, same precedent as every other modal).
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    document.addEventListener('keydown', handleEscape);
    document.body.appendChild(overlay);
  })();
}

function renderEditor(isBuiltIn: boolean, editName: string, editColors: Record<string, string>): SafeHtml {
  const headerText = isBuiltIn ? 'Edit Theme (will create a copy)' : 'Edit Theme';
  return (
    <>
      <div className="settings-header">
        <h3>{headerText}</h3>
        <button className="settings-close" id="te-close"><IconX /></button>
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
              <div data-key={`row-${varName}`} className="theme-editor-row" data-var={varName}>
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
  );
}
