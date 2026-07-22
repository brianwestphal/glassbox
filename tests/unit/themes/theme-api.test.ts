import { Hono } from 'hono';

vi.mock('../../../src/themes/config.js', () => ({
  getAllThemes: vi.fn(),
  getActiveThemeId: vi.fn(),
  getActiveThemeColors: vi.fn(),
  resolveTheme: vi.fn(),
  setActiveThemeId: vi.fn(),
  saveCustomTheme: vi.fn(),
  deleteCustomTheme: vi.fn(),
  generateThemeId: vi.fn().mockReturnValue('new-id-123'),
}));

import {
  deleteCustomTheme, getAllThemes, getActiveThemeColors, getActiveThemeId,
  resolveTheme, saveCustomTheme, setActiveThemeId,
} from '../../../src/themes/config.js';
import { themeApiRoutes } from '../../../src/routes/theme-api.js';
import type { AppEnv } from '../../../src/types.js';

function createApp() {
  const app = new Hono<AppEnv>();
  app.route('/themes', themeApiRoutes);
  return app;
}

const darkTheme = {
  id: 'dark', name: 'Dark', builtIn: true,
  colors: { bg: '#1e1e2e', text: '#cdd6f4' },
};

const customTheme = {
  id: 'custom-1', name: 'My Theme', builtIn: false, baseTheme: 'dark',
  colors: { bg: '#111', text: '#eee' },
};

describe('GET /themes', () => {
  const app = createApp();
  beforeEach(() => vi.resetAllMocks());

  it('returns all themes and active ID', async () => {
    vi.mocked(getAllThemes).mockReturnValue([darkTheme, customTheme] as any);
    vi.mocked(getActiveThemeId).mockReturnValue('dark');
    const res = await app.request('/themes');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.themes).toHaveLength(2);
    expect(data.activeId).toBe('dark');
  });
});

describe('GET /themes/active', () => {
  const app = createApp();
  beforeEach(() => vi.resetAllMocks());

  it('returns active theme ID and colors', async () => {
    vi.mocked(getActiveThemeId).mockReturnValue('dark');
    vi.mocked(getActiveThemeColors).mockReturnValue({ bg: '#1e1e2e' } as any);
    const res = await app.request('/themes/active');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe('dark');
    expect(data.colors.bg).toBe('#1e1e2e');
  });
});

describe('POST /themes/active', () => {
  const app = createApp();
  beforeEach(() => vi.resetAllMocks());

  it('sets the active theme', async () => {
    vi.mocked(resolveTheme).mockReturnValue(darkTheme as any);
    const res = await app.request('/themes/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'dark' }),
    });
    expect(res.status).toBe(200);
    expect(setActiveThemeId).toHaveBeenCalledWith('dark');
  });

  it('returns 400 when id is missing', async () => {
    const res = await app.request('/themes/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown theme', async () => {
    vi.mocked(resolveTheme).mockReturnValue(undefined);
    const res = await app.request('/themes/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /themes (duplicate)', () => {
  const app = createApp();
  beforeEach(() => vi.resetAllMocks());

  it('duplicates a built-in theme', async () => {
    vi.mocked(resolveTheme).mockReturnValue(darkTheme as any);
    const res = await app.request('/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'dark' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe('Dark (Copy)');
    expect(data.baseTheme).toBe('dark');
    expect(data.builtIn).toBe(false);
    expect(saveCustomTheme).toHaveBeenCalled();
  });

  it('duplicates with custom name', async () => {
    vi.mocked(resolveTheme).mockReturnValue(darkTheme as any);
    const res = await app.request('/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'dark', name: 'My Dark' }),
    });
    const data = await res.json();
    expect(data.name).toBe('My Dark');
  });

  it('duplicates a custom theme (preserves baseTheme)', async () => {
    vi.mocked(resolveTheme).mockReturnValue(customTheme as any);
    const res = await app.request('/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'custom-1' }),
    });
    const data = await res.json();
    expect(data.baseTheme).toBe('dark'); // inherited from source
  });

  it('returns 400 when sourceId is missing', async () => {
    const res = await app.request('/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown source', async () => {
    vi.mocked(resolveTheme).mockReturnValue(undefined);
    const res = await app.request('/themes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /themes/:id/edit', () => {
  const app = createApp();
  beforeEach(() => vi.resetAllMocks());

  it('auto-copies a built-in theme on edit', async () => {
    vi.mocked(resolveTheme).mockReturnValue(darkTheme as any);
    const { generateThemeId } = await import('../../../src/themes/config.js');
    vi.mocked(generateThemeId).mockReturnValue('new-id-123');
    const res = await app.request('/themes/dark/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: { bg: '#000' } }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.copied).toBe(true);
    expect(data.theme.name).toBe('Dark (Customized)');
    expect(data.theme.colors.bg).toBe('#000');
    expect(setActiveThemeId).toHaveBeenCalledWith('new-id-123');
    expect(saveCustomTheme).toHaveBeenCalled();
  });

  it('edits a custom theme in place', async () => {
    vi.mocked(resolveTheme).mockReturnValue(customTheme as any);
    const res = await app.request('/themes/custom-1/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: { bg: '#222' } }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.copied).toBe(false);
    expect(data.theme.colors.bg).toBe('#222');
  });

  it('supports custom name on built-in edit', async () => {
    vi.mocked(resolveTheme).mockReturnValue(darkTheme as any);
    const res = await app.request('/themes/dark/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Custom Dark' }),
    });
    const data = await res.json();
    expect(data.theme.name).toBe('My Custom Dark');
  });

  it('returns 404 for unknown theme', async () => {
    vi.mocked(resolveTheme).mockReturnValue(undefined);
    const res = await app.request('/themes/nope/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /themes/:id', () => {
  const app = createApp();
  beforeEach(() => vi.resetAllMocks());

  it('updates a custom theme', async () => {
    vi.mocked(resolveTheme).mockReturnValue(customTheme as any);
    const res = await app.request('/themes/custom-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('Renamed');
    expect(saveCustomTheme).toHaveBeenCalled();
  });

  it('updates colors on a custom theme', async () => {
    vi.mocked(resolveTheme).mockReturnValue(customTheme as any);
    const res = await app.request('/themes/custom-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: { bg: '#333' } }),
    });
    const data = await res.json();
    expect(data.colors.bg).toBe('#333');
  });

  it('returns 400 for built-in theme', async () => {
    const res = await app.request('/themes/dark', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown theme', async () => {
    vi.mocked(resolveTheme).mockReturnValue(undefined);
    const res = await app.request('/themes/unknown', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /themes/:id', () => {
  const app = createApp();
  beforeEach(() => vi.resetAllMocks());

  it('deletes a custom theme', async () => {
    vi.mocked(getActiveThemeId).mockReturnValue('dark');
    const res = await app.request('/themes/custom-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(deleteCustomTheme).toHaveBeenCalledWith('custom-1');
  });

  // Slug guard (doc 14): Hono percent-decodes the param, so an encoded
  // traversal id would otherwise reach unlinkSync(join(THEMES_DIR, id + '.json')).
  it('rejects a traversal id with 400 without touching the filesystem', async () => {
    const res = await app.request(`/themes/${encodeURIComponent('../../config')}`, { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(deleteCustomTheme).not.toHaveBeenCalled();
  });

  it('rejects a leading-dot id with 400', async () => {
    const res = await app.request('/themes/.hidden', { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(deleteCustomTheme).not.toHaveBeenCalled();
  });

  it('falls back to default when deleting active theme', async () => {
    vi.mocked(getActiveThemeId).mockReturnValue('custom-1');
    const res = await app.request('/themes/custom-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(setActiveThemeId).toHaveBeenCalledWith('dark');
  });

  it('returns 400 for built-in theme', async () => {
    const res = await app.request('/themes/dark', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});
