import { getDefaultModel, getModelContextWindow, MODELS, PLATFORMS, ENV_KEY_NAMES } from '../../../src/ai/models.js';
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
});

describe('PLATFORMS', () => {
  it('maps platform IDs to display names', () => {
    expect(PLATFORMS.anthropic).toBe('Anthropic');
    expect(PLATFORMS.openai).toBe('OpenAI');
    expect(PLATFORMS.google).toBe('Google');
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

describe('getModelContextWindow', () => {
  it('returns the context window for a known model', () => {
    const anthropicDefault = MODELS.anthropic.find(m => m.isDefault)!;
    expect(getModelContextWindow('anthropic', anthropicDefault.id)).toBe(anthropicDefault.contextWindow);
  });

  it('returns 128000 for unknown model IDs', () => {
    expect(getModelContextWindow('anthropic', 'nonexistent-model')).toBe(128000);
  });
});
