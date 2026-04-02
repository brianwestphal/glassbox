# 15. Themes

Requirements for visual theming, built-in theme selection, and custom theme creation.

## Functional Requirements

### 15.1 Theme System

- The application shall support visual themes that control all UI colors via CSS custom properties.
- Each theme shall define values for all color variables used in the application (backgrounds, text, accents, semantic colors, diff colors, gutter colors, borders).
- Themes shall be applied instantly without page reload by updating CSS custom properties on `document.documentElement`.
- The active theme shall persist across sessions via `~/.glassbox/config.json`.

### 15.2 Built-in Themes

- The application shall include the following built-in themes:
  - **Dark** (default) — Catppuccin Mocha-inspired dark theme with muted pastels
  - **Light** — GitHub Light-inspired light theme with clear contrast
  - **High Contrast Dark** — WCAG AAA-compliant dark theme with increased contrast ratios
  - **High Contrast Light** — WCAG AAA-compliant light theme with increased contrast ratios
  - **Dracula** — Dracula color scheme
  - **Tokyo Night** — Tokyo Night color scheme
- Built-in themes shall not be directly editable or deletable.

### 15.3 Custom Themes

- Users shall be able to create custom themes by duplicating any existing theme (built-in or custom).
- Custom themes shall be stored in `~/.glassbox/themes/` as individual JSON files.
- Custom themes shall be editable, renamable, and deletable.
- If a user attempts to edit a built-in theme (e.g., changing a color), the system shall:
  1. Automatically create a copy named `"<original name> (Customized)"`.
  2. Apply the pending edit to the copy.
  3. Switch the active theme to the copy.
  4. This shall happen seamlessly without disrupting the user's workflow.

### 15.4 Theme Variables

Each theme shall define the following color groups (no font customization):

**Backgrounds:**
- `bg` — Main background
- `bg-surface` — Elevated surface (cards, panels)
- `bg-hover` — Hover state
- `bg-active` — Active/selected state

**Text:**
- `text` — Primary text
- `text-dim` — Secondary/muted text
- `text-bright` — Emphasized text

**Accent:**
- `accent` — Primary accent color (links, focused elements)
- `accent-hover` — Accent hover state

**Semantic Colors:**
- `green`, `red`, `yellow`, `orange`, `blue`, `purple`, `teal`

**Border:**
- `border` — Default border color

**Diff:**
- `diff-add-bg`, `diff-add-border` — Added line colors
- `diff-remove-bg`, `diff-remove-border` — Removed line colors

**Gutter:**
- `gutter-bg` — Line number gutter background
- `gutter-text` — Line number text

### 15.5 Theme Selection in Settings

- The settings dialog shall include theme selection in the **General** tab.
- Theme selection shall use a dropdown listing all available themes (built-in first, then custom, separated by a divider).
- A **Manage Themes** button shall open the theme manager dialog.
- Changing the theme in the dropdown shall apply immediately (auto-save, no confirmation needed).

### 15.6 Theme Manager Dialog

- The theme manager shall be a separate modal dialog accessible from the settings dialog.
- The theme manager shall display all themes in a list with:
  - Theme name
  - Badge indicating "Built-in" or "Custom"
  - Color preview swatches (showing a few key colors: bg, text, accent, green, red)
- Available actions:
  - **Duplicate** — Available for all themes. Creates a copy named `"<name> (Copy)"`.
  - **Edit** — Opens the theme editor for the selected theme. For built-in themes, auto-creates a customized copy first (per FR-15.3).
  - **Rename** — Available for custom themes only.
  - **Delete** — Available for custom themes only. If the deleted theme is active, switches to the default Dark theme.
- The dialog shall be closeable via close button, clicking outside, or pressing Escape.

### 15.7 Theme Editor

- The theme editor shall be accessible from the theme manager (via Edit action).
- It shall display all color variables grouped by category (as defined in FR-15.4).
- Each color shall have:
  - A descriptive label (e.g., "Main background", "Added line highlight")
  - A color swatch showing the current value
  - A native color picker input for selection
  - A text input showing the hex/rgba value (editable)
- Changes shall apply live as the user picks colors (immediate preview).
- Changes shall auto-save when the editor is closed.
- A **Reset** button per color shall revert to the base theme's value for that color.
- A **Reset All** button shall revert all colors to the base theme's values.

### 15.8 Theme File Format

Custom theme files (`~/.glassbox/themes/<id>.json`) shall use the following format:

```json
{
  "id": "unique-id",
  "name": "My Custom Theme",
  "baseTheme": "dark",
  "colors": {
    "bg": "#1e1e2e",
    "bg-surface": "#252536",
    "text": "#cdd6f4",
    ...
  }
}
```

- `id` — Unique identifier (generated, used as filename).
- `name` — Display name (user-editable).
- `baseTheme` — ID of the built-in theme this was derived from (for Reset operations).
- `colors` — Complete set of color overrides. All variables from FR-15.4 must be present.

### 15.9 Theme API

- `GET /api/themes` — List all available themes (built-in + custom) with metadata.
- `POST /api/themes` — Create a new custom theme (duplicate).
- `PATCH /api/themes/:id` — Update a custom theme (rename, edit colors).
- `DELETE /api/themes/:id` — Delete a custom theme.
- `POST /api/themes/active` — Set the active theme.
- `GET /api/themes/active` — Get the active theme ID and resolved colors.

## Non-Functional Requirements

### 15.10 Performance

- Theme switching shall be instantaneous (CSS custom property update, no re-render or reload).
- Theme file I/O shall not block the UI.

### 15.11 Accessibility

- High contrast themes shall meet WCAG 2.1 Level AAA contrast ratios (7:1 for normal text, 4.5:1 for large text).
- The theme editor color picker shall use the browser's native `<input type="color">` for accessibility.

### 15.12 Compatibility

- Themes shall work identically in both the browser and Tauri desktop app.
- The theme system shall not affect the SCSS build process — all theming happens at runtime via CSS custom properties.
