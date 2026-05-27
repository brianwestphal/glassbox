import { describe, expect, it } from 'vitest';

import { StoredCustomThemeSchema } from '../../../src/api/themes.js';

/**
 * GB-826 — custom theme files on disk are now validated at the read boundary
 * (`loadCustomThemes` / `getCustomTheme`) instead of being blindly cast. These
 * tests pin what `StoredCustomThemeSchema` accepts and rejects.
 */
describe('StoredCustomThemeSchema', () => {
  const valid = {
    id: 'my-theme',
    name: 'My Theme',
    baseTheme: 'dark',
    colors: { bg: '#000', text: '#fff' },
  };

  it('accepts a well-formed custom theme', () => {
    expect(StoredCustomThemeSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a partial colors map (forward-compatible with new theme vars)', () => {
    // Intentionally lenient: a theme missing some keys must not be rejected —
    // missing vars fall back to :root at apply time.
    const r = StoredCustomThemeSchema.safeParse({ ...valid, colors: { bg: '#111' } });
    expect(r.success).toBe(true);
  });

  it('rejects a missing/empty id or name', () => {
    expect(StoredCustomThemeSchema.safeParse({ ...valid, id: '' }).success).toBe(false);
    expect(StoredCustomThemeSchema.safeParse({ ...valid, name: undefined }).success).toBe(false);
  });

  it('rejects colors that is not an object of strings', () => {
    expect(StoredCustomThemeSchema.safeParse({ ...valid, colors: 'red' }).success).toBe(false);
    expect(StoredCustomThemeSchema.safeParse({ ...valid, colors: { bg: 123 } }).success).toBe(false);
    expect(StoredCustomThemeSchema.safeParse({ ...valid, colors: undefined }).success).toBe(false);
  });
});
