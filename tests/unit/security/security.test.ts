/**
 * Security tests verifying FR-14.x requirements.
 * Tests shell injection prevention, input escaping, and API key safety.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC_ROOT = join(__dirname, '..', '..', '..', 'src');

describe('FR-14.1.1: Server binds to 127.0.0.1 only', () => {
  it('server.ts binds to 127.0.0.1', () => {
    const content = readFileSync(join(SRC_ROOT, 'server.ts'), 'utf-8');
    expect(content).toContain("hostname: '127.0.0.1'");
  });
});

describe('FR-14.3: Shell command safety', () => {
  it('git/spawn.ts runs git via spawnSync (the shared git() helper)', () => {
    // The shared `git()` / `scrubbedGitEnv()` helpers used by diff.ts and repo.ts
    // live here (GB-889 consolidation). This is where the argv-array spawn lives.
    const content = readFileSync(join(SRC_ROOT, 'git', 'spawn.ts'), 'utf-8');
    expect(content).toContain('spawnSync');
    expect(content).not.toMatch(/exec\(`git\s/);
    expect(content).not.toMatch(/execSync\(`git\s/);
  });

  it('git/diff.ts does not run git via exec with string interpolation', () => {
    // diff.ts now spawns git through the shared `git()` helper from spawn.ts,
    // but it must never reintroduce a shell-interpolated git command.
    const content = readFileSync(join(SRC_ROOT, 'git', 'diff.ts'), 'utf-8');
    expect(content).not.toMatch(/exec\(`git\s/);
    expect(content).not.toMatch(/execSync\(`git\s/);
  });

  it('git/image.ts uses spawnSync for git commands', () => {
    const content = readFileSync(join(SRC_ROOT, 'git', 'image.ts'), 'utf-8');
    expect(content).toContain('spawnSync');
    expect(content).not.toMatch(/exec\(`git\s/);
    expect(content).not.toMatch(/execSync\(`git\s/);
  });

  it('ai/keychain.ts uses spawnSync for keychain commands', () => {
    const content = readFileSync(join(SRC_ROOT, 'ai', 'keychain.ts'), 'utf-8');
    expect(content).toContain('spawnSync');
    expect(content).not.toMatch(/execSync\(/);
  });

  it('export/generate.ts uses spawnSync for git check-ignore', () => {
    const content = readFileSync(join(SRC_ROOT, 'export', 'generate.ts'), 'utf-8');
    expect(content).toContain('spawnSync');
    expect(content).not.toMatch(/execSync\(/);
  });

  it('getDiffArgs returns arrays (not interpolated strings)', () => {
    const content = readFileSync(join(SRC_ROOT, 'git', 'diff.ts'), 'utf-8');
    // getDiffArgs should return string[] not string
    expect(content).toMatch(/getDiffArgs\(mode: ReviewMode\): string\[\]/);
  });
});

describe('FR-14.4.3: API keys not exposed in errors', () => {
  it('ai/client.ts error messages do not include apiKey', () => {
    const content = readFileSync(join(SRC_ROOT, 'ai', 'client.ts'), 'utf-8');
    // Error throws should not include the apiKey variable
    const errorThrows = content.match(/throw new Error\(.*?\)/gs);
    expect(errorThrows).toBeDefined();
    for (const errThrow of errorThrows!) {
      expect(errThrow).not.toContain('apiKey');
      expect(errThrow).not.toContain('config.apiKey');
    }
  });
});

describe('NFR-8.8.4: XSS prevention via SafeHtml', () => {
  it('jsx runtime auto-escapes string children', async () => {
    const { jsx } = await import('kerfjs/jsx-runtime');
    const result = jsx('div', { children: '<script>alert("xss")</script>' });
    const html = result.toString();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('jsx runtime escapes attribute values', async () => {
    const { jsx } = await import('kerfjs/jsx-runtime');
    const result = jsx('div', { title: '"><script>alert(1)</script>' });
    const html = result.toString();
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;');
  });
});

describe('FR-14.2: API input validation', () => {
  it('api/annotations.ts validates annotation creation fields', () => {
    const content = readFileSync(join(SRC_ROOT, 'routes', 'api', 'annotations.ts'), 'utf-8');
    // Should have validation for required fields
    expect(content).toContain('reviewFileId');
    expect(content).toContain('lineNumber');
    expect(content).toContain('category');
    expect(content).toContain('content');
  });

  it('ai-analysis.ts validates analysis type', () => {
    const content = readFileSync(join(SRC_ROOT, 'routes', 'ai-analysis.ts'), 'utf-8');
    // Validation is now done via the AnalysisTypeSchema zod schema
    // imported from the typed API layer, which enumerates the three
    // analysis types and produces structured 400 errors on mismatch.
    expect(content).toContain('AnalysisTypeSchema');
    expect(content).toContain('400');
    // The schema definition itself lives in the typed API module.
    const schemaContent = readFileSync(join(SRC_ROOT, 'api', 'ai.ts'), 'utf-8');
    expect(schemaContent).toContain("'risk'");
    expect(schemaContent).toContain("'narrative'");
    expect(schemaContent).toContain("'guided'");
  });
});

describe('FR-14.4.2: Config file key encoding', () => {
  it('ai/api-keys.ts base64-encodes API keys in config file', () => {
    const content = readFileSync(join(SRC_ROOT, 'ai', 'api-keys.ts'), 'utf-8');
    expect(content).toContain("Buffer.from(key).toString('base64')");
    expect(content).toContain("Buffer.from(encoded, 'base64')");
  });

  it('global-config.ts sets 0600 permissions on the shared config file', () => {
    const content = readFileSync(join(SRC_ROOT, 'global-config.ts'), 'utf-8');
    expect(content).toContain('0o600');
  });
});
