/**
 * Convention / requirement-level invariants that line coverage cannot express.
 *
 * These are the "would fail if this project rule regressed" assertions — the
 * structural guards that no amount of executing lines would catch. They pair
 * with the feature-coverage report (docs/testing/9-feature-coverage.md): the
 * report checks that every documented behavior has a test; this file pins the
 * cross-cutting rules the docs promise.
 */
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** All numbered requirements docs, e.g. `1-review-workflow.md`. */
function numberedDocs(): { num: number; file: string }[] {
  return readdirSync(join(ROOT, 'docs'))
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .map((file) => ({ num: parseInt(file), file }))
    .sort((a, b) => a.num - b.num);
}

describe('requirements docs', () => {
  it('are numbered contiguously from 1 with no gaps or duplicates', () => {
    const nums = numberedDocs().map((d) => d.num);
    expect(nums.length).toBeGreaterThan(0);
    expect(new Set(nums).size).toBe(nums.length); // no duplicate numbers
    for (let i = 0; i < nums.length; i++) {
      expect(nums[i]).toBe(i + 1); // 1..N contiguous
    }
  });

  it('are each referenced in the CLAUDE.md documentation index', () => {
    const claudeMd = read('CLAUDE.md');
    for (const { file } of numberedDocs()) {
      expect(claudeMd, `CLAUDE.md should reference docs/${file}`).toContain(file);
    }
  });

  it('have no duplicate FR-/NFR- ids within a doc', () => {
    for (const { file } of numberedDocs()) {
      const md = read(join('docs', file));
      const ids = [...md.matchAll(/\*\*(FR|NFR)-(\d+(?:\.\d+)*[a-z]?)/g)].map((m) => `${m[1]}-${m[2]}`);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `duplicate requirement ids in docs/${file}: ${dupes.join(', ')}`).toEqual([]);
    }
  });
});

describe('external dependency allow-list (the three-places rule)', () => {
  // A server dep kept external by tsup MUST also be copied into the sidecar by
  // build-sidecar.sh AND documented in CLAUDE.md, or the production desktop app
  // breaks with "module not found". These three lists must agree.

  /** Package prefixes tsup keeps external (the negative-lookahead alternatives). */
  function tsupExternalPrefixes(): string[] {
    const cfg = read('tsup.config.ts');
    const m = cfg.match(/noExternal:\s*\[\/\^\(\?!([^)]*)\)/);
    expect(m, 'could not find the noExternal negative-lookahead in tsup.config.ts').toBeTruthy();
    return m![1].split('|').map((s) => s.trim());
  }

  /** Packages copied into the sidecar by build-sidecar.sh. */
  function sidecarPackages(): string[] {
    const sh = read('scripts/build-sidecar.sh');
    const m = sh.match(/for pkg in ([^;]+);/);
    expect(m, 'could not find the `for pkg in ...` loop in build-sidecar.sh').toBeTruthy();
    return m![1].trim().split(/\s+/);
  }

  it('every tsup-external prefix is covered by a sidecar-copied package', () => {
    const prefixes = tsupExternalPrefixes();
    const pkgs = sidecarPackages();
    for (const prefix of prefixes) {
      const covered = pkgs.some((p) => p === prefix || p.startsWith(prefix + '/'));
      expect(covered, `tsup keeps "${prefix}" external but build-sidecar.sh copies no matching package`).toBe(true);
    }
  });

  it('every sidecar-copied package matches a tsup-external prefix', () => {
    const prefixes = tsupExternalPrefixes();
    const pkgs = sidecarPackages();
    for (const pkg of pkgs) {
      const matched = prefixes.some((prefix) => pkg === prefix || pkg.startsWith(prefix + '/'));
      expect(matched, `build-sidecar.sh copies "${pkg}" but tsup does not keep it external`).toBe(true);
    }
  });

  it('every sidecar-copied package is documented in CLAUDE.md', () => {
    const claudeMd = read('CLAUDE.md');
    for (const pkg of sidecarPackages()) {
      expect(claudeMd, `CLAUDE.md should document the external dep "${pkg}"`).toContain(pkg);
    }
  });
});

describe('forbidden imports', () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('src/ imports no react / react-dom (the project uses the kerfjs JSX runtime)', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'src'))) {
      const src = readFileSync(file, 'utf8');
      if (/\bfrom\s+['"]react(-dom)?['"]/.test(src)) offenders.push(file);
    }
    expect(offenders, `react import(s) found: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('Tauri launcher ↔ CLI stdout contract', () => {
  // The desktop launcher (src-tauri/src/lib.rs) reads the server's stdout to
  // decide what to show: it navigates on "running at " and shows a "no changes"
  // message on the empty-diff marker. If the CLI's wording drifts, the launcher
  // would silently hang on the loading spinner again (GB-1057) — these pin the
  // two magic strings to the same source of truth.
  it('the empty-diff "No changes found" marker matches between cli.ts and lib.rs', () => {
    expect(read('src/cli.ts')).toContain('No changes found');
    const rust = read('src-tauri/src/lib.rs');
    expect(rust).toContain('const NO_CHANGES_MARKER: &str = "No changes found"');
  });

  it('the "running at " readiness line matches between server startup and lib.rs', () => {
    // The server prints "Glassbox running at <url>"; the launcher parses "running at ".
    expect(read('src/server.ts')).toContain('running at');
    expect(read('src-tauri/src/lib.rs')).toContain('running at ');
  });
});
