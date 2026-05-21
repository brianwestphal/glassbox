/**
 * Regression tests for GB-790 — the diff mount root must remain the single
 * source of truth for `#diff-container`.
 *
 * The bug: code outside `src/client/diff/index.tsx` looked up
 * `document.getElementById('diff-container')` and assigned `container.innerHTML
 * = ...` directly. That bypasses the `diffContentSignal` -> `mount()` pipeline,
 * so the next reactive update to the signal morphs against the manually-set
 * HTML and produces inconsistent results.
 *
 * The fix is to route raw-file HTML through `setRawDiffContent(filePath,
 * html)`, which writes the signal and bumps the generation. These tests
 * guard against the regression class by:
 *
 *  1. Scanning every client source file (except `diff/index.tsx`, where the
 *     mount actually lives) for `container.innerHTML = ...` writes against a
 *     `#diff-container` lookup.
 *  2. Verifying that `setRawDiffContent` is exported from `diff/index.tsx`
 *     and used by both raw-file callsites (`app.tsx`, `diff/goToDefinition.tsx`).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const CLIENT_ROOT = join(__dirname, '..', '..', '..', 'src', 'client');
const MOUNT_OWNER = join(CLIENT_ROOT, 'diff', 'index.tsx');

function walkClientSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'styles') continue; // SCSS partials, not TS
      out.push(...walkClientSources(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('GB-790: #diff-container mount root invariants', () => {
  it('only diff/index.tsx writes to #diff-container.innerHTML', () => {
    const offenders: string[] = [];
    for (const file of walkClientSources(CLIENT_ROOT)) {
      if (file === MOUNT_OWNER) continue;
      const src = readFileSync(file, 'utf-8');

      // Find any binding obtained from `getElementById('diff-container')` and
      // check whether the same identifier is later assigned `.innerHTML = ...`
      // in the file. This catches both the direct-write shape and aliased
      // variables.
      const lookups = [...src.matchAll(
        /\b(?:const|let|var)\s+(\w+)\s*=\s*document\.getElementById\(\s*['"]diff-container['"]\s*\)/g,
      )];
      for (const m of lookups) {
        const name = m[1];
        const assignPattern = new RegExp(`\\b${name}\\.innerHTML\\s*=`);
        if (assignPattern.test(src)) {
          offenders.push(`${relative(CLIENT_ROOT, file)} assigns ${name}.innerHTML after getElementById('diff-container')`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('diff/index.tsx exports setRawDiffContent', () => {
    const src = readFileSync(MOUNT_OWNER, 'utf-8');
    expect(src).toMatch(/export\s+function\s+setRawDiffContent\s*\(/);
  });

  it('app.tsx routes raw-file HTML through setRawDiffContent', () => {
    const src = readFileSync(join(CLIENT_ROOT, 'app.tsx'), 'utf-8');
    expect(src).toContain('setRawDiffContent(');
    // Negative: the old `container.innerHTML = await res.text()` shape must
    // not reappear in the raw-file branch.
    expect(src).not.toMatch(/container\.innerHTML\s*=\s*await/);
  });

  it('diff/goToDefinition.tsx routes raw-file HTML through setRawDiffContent', () => {
    const src = readFileSync(join(CLIENT_ROOT, 'diff', 'goToDefinition.tsx'), 'utf-8');
    expect(src).toContain('setRawDiffContent(');
    expect(src).not.toMatch(/container\.innerHTML\s*=\s*await/);
  });
});
