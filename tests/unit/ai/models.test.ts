import { APPLE_ON_DEVICE_MODEL_ID, getDefaultModel, getModelContextWindow, KEYLESS_PLATFORMS, MODELS, PLATFORMS, ENV_KEY_NAMES, resolveModelId } from '../../../src/ai/models.js';
import type { AIPlatform } from '../../../src/ai/models.js';

describe('MODELS', () => {
  it('has entries for all three platforms', () => {
    expect(MODELS.anthropic.length).toBeGreaterThan(0);
    expect(MODELS.openai.length).toBeGreaterThan(0);
    expect(MODELS.google.length).toBeGreaterThan(0);
  });

  it('each platform has exactly one default model', () => {
    for (const platform of ['anthropic', 'openai', 'google'] as AIPlatform[]) {
      const defaults = MODELS[platform].filter(m => m.isDefault);
      expect(defaults).toHaveLength(1);
    }
  });

  it('all models have required fields', () => {
    for (const platform of ['anthropic', 'openai', 'google'] as AIPlatform[]) {
      for (const model of MODELS[platform]) {
        expect(model.id).toBeTruthy();
        expect(model.name).toBeTruthy();
        expect(model.contextWindow).toBeGreaterThan(0);
        expect(typeof model.isDefault).toBe('boolean');
      }
    }
  });

  // GB-893 — the default Anthropic model was a dated snapshot
  // (`claude-sonnet-4-20250514`) that hit its scheduled retirement and started
  // returning 404 on every analysis. Anthropic publishes bare *aliases*
  // (`claude-sonnet-4-6`) that don't carry a retirement date; the dated
  // `-YYYYMMDD` snapshots do. Enforce the alias form so a snapshot ID can't be
  // reintroduced and silently 404 once it's retired.
  it('uses bare Anthropic model aliases, not dated snapshot IDs (GB-893)', () => {
    for (const model of MODELS.anthropic) {
      expect(model.id, `${model.id} looks like a dated snapshot — use the bare alias`)
        .not.toMatch(/-20\d{6}$/);
    }
  });
});

describe('PLATFORMS', () => {
  it('maps platform IDs to display names', () => {
    expect(PLATFORMS.anthropic).toBe('Anthropic');
    expect(PLATFORMS.openai).toBe('OpenAI');
    expect(PLATFORMS.google).toBe('Google');
    expect(PLATFORMS.local).toBe('Local');
    expect(PLATFORMS.apple).toBe('Apple');
  });
});

describe('apple platform (doc 22 P2)', () => {
  it('is keyless and offers a single on-device default model', () => {
    expect(KEYLESS_PLATFORMS.has('apple')).toBe(true);
    expect(MODELS.apple).toHaveLength(1);
    expect(MODELS.apple[0].id).toBe(APPLE_ON_DEVICE_MODEL_ID);
    expect(MODELS.apple.filter(m => m.isDefault)).toHaveLength(1);
    expect(getDefaultModel('apple')).toBe(APPLE_ON_DEVICE_MODEL_ID);
  });

  it('uses a small, conservative context window for batch planning', () => {
    expect(getModelContextWindow('apple', APPLE_ON_DEVICE_MODEL_ID)).toBe(4096);
    expect(getModelContextWindow('apple', 'unknown')).toBe(4096);
  });
});

describe('ENV_KEY_NAMES', () => {
  it('maps platforms to environment variable names', () => {
    expect(ENV_KEY_NAMES.anthropic).toBe('ANTHROPIC_API_KEY');
    expect(ENV_KEY_NAMES.openai).toBe('OPENAI_API_KEY');
    expect(ENV_KEY_NAMES.google).toBe('GEMINI_API_KEY');
  });
});

describe('getDefaultModel', () => {
  it('returns the default model for each platform', () => {
    for (const platform of ['anthropic', 'openai', 'google'] as AIPlatform[]) {
      const defaultId = getDefaultModel(platform);
      const model = MODELS[platform].find(m => m.id === defaultId);
      expect(model).toBeDefined();
      expect(model!.isDefault).toBe(true);
    }
  });
});

describe('resolveModelId (GB-893 — best-effort version matching)', () => {
  it('returns a currently-offered id unchanged', () => {
    expect(resolveModelId('anthropic', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('maps a retired dated snapshot to the current same-tier model', () => {
    // The exact id from the GB-893 404.
    expect(resolveModelId('anthropic', 'claude-sonnet-4-20250514')).toBe('claude-sonnet-4-6');
  });

  it('best-effort matches an older version to the newer one (sonnet 4.5 → 4.6)', () => {
    expect(resolveModelId('anthropic', 'claude-sonnet-4-5')).toBe('claude-sonnet-4-6');
  });

  it('matches by tier across families (opus stays opus, haiku stays haiku)', () => {
    expect(resolveModelId('anthropic', 'claude-opus-4-1')).toBe('claude-opus-4-8');
    expect(resolveModelId('anthropic', 'claude-haiku-4-20250514')).toBe('claude-haiku-4-5');
  });

  it('matches Google tiers (older gemini pro/flash → current)', () => {
    expect(resolveModelId('google', 'gemini-1.5-pro')).toBe('gemini-2.5-pro');
    expect(resolveModelId('google', 'gemini-1.5-flash')).toBe('gemini-2.5-flash');
  });

  it('falls back to the platform default when no family matches', () => {
    expect(resolveModelId('anthropic', 'some-unknown-model')).toBe(getDefaultModel('anthropic'));
  });
});

describe('getModelContextWindow', () => {
  it('returns the context window for a known model', () => {
    const anthropicDefault = MODELS.anthropic.find(m => m.isDefault)!;
    expect(getModelContextWindow('anthropic', anthropicDefault.id)).toBe(anthropicDefault.contextWindow);
  });

  it('returns 128000 for unknown model IDs', () => {
    expect(getModelContextWindow('anthropic', 'nonexistent-model')).toBe(128000);
  });
});
