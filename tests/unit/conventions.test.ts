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

  it('shipped first-party plugins register no main-app UI elements (doc 30)', () => {
    // Doc-30 slots (header / diff-toolbar / sidebar-footer) are global chrome:
    // an element registered there shows on every review, regardless of whether
    // the current file is one the plugin handles. The graphviz plugin once
    // shipped a demo "Graphviz" button + "Grid" toggle this way — permanently
    // visible once the plugin was installed. Demo/worked-example UI elements
    // belong in the e2e fixture plugin (tests/fixtures/plugin/fixture-diagram/),
    // not in shipped plugins. If a shipped plugin someday needs a genuinely
    // always-relevant control, update this test deliberately alongside it.
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'plugins'))) {
      if (file.includes('node_modules')) continue;
      const src = readFileSync(file, 'utf8');
      // Match calls (`context.registerUI(...)`), not the interface declaration
      // in each plugin's standalone types.ts copy.
      if (/\.registerUI\s*\(/.test(src)) offenders.push(file);
    }
    expect(offenders, `registerUI call(s) in shipped plugins: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('ground-truth capture determinism', () => {
  // The screenshot regression suite only works if two captures of an unchanged
  // UI are byte-identical. A running CSS animation breaks that: the sidebar's
  // "Guided review…" spinner was caught at a different rotation angle each run,
  // giving several scenes a permanent few-pixel delta no baseline rotation
  // could settle — and a noise floor that would hide a genuine sub-pixel
  // regression. `animations: 'disabled'` rewinds infinite animations to their
  // first frame, which is what makes the pixels repeatable.
  //
  // Proving actual determinism needs two full capture runs (a server + Chromium
  // per scene), far too slow for a unit test. This pins the one-line control
  // that delivers it, so removing it fails here rather than silently in a
  // baseline rotation weeks later.
  it('the capture harness freezes animations when screenshotting', () => {
    const src = readFileSync(join(ROOT, 'scripts/ground-truth/capture-screenshots.ts'), 'utf8');
    const calls = [...src.matchAll(/\.screenshot\(([^)]*)\)/g)].map(m => m[1]);
    expect(calls.length, 'expected a page.screenshot(...) call in the capture harness').toBeGreaterThan(0);
    for (const args of calls) {
      expect(args, `screenshot call without animations: 'disabled': ${args}`).toContain("animations: 'disabled'");
    }
  });
});

describe('live-render tests stay out of the default suite', () => {
  // The PlantUML and Mermaid renderers spawn a real JVM and a real headless
  // Chromium. Run alongside the ~150 concurrently-executing test files of the
  // default suite they lost the CPU race — the JVM blew a 30s timeout and
  // Chromium failed to launch at all — while both passed in seconds alone. That
  // made `npm test` red on a clean tree, which trains everyone to stop reading
  // the result.
  //
  // The fix is the `GLASSBOX_LIVE_RENDER_TESTS` gate, set only by
  // `vitest.config.live.ts` (`npm run test:live`), which also disables file
  // parallelism so the two heavyweights don't contend with each other either.
  // A tooling gate alone is NOT enough: `describe.skipIf(!hasJava)` still runs
  // the test on any machine that happens to have the tool installed, which is
  // exactly how this regressed. Pin the env gate so a future live test can't
  // rejoin the default suite by only checking for its binary.
  const LIVE_TESTS = ['tests/unit/plugins/mermaid.test.ts', 'tests/unit/plugins/plantuml.test.ts'];

  it.each(LIVE_TESTS)('%s gates its live render on GLASSBOX_LIVE_RENDER_TESTS', (rel) => {
    const src = read(rel);
    expect(src).toContain("process.env.GLASSBOX_LIVE_RENDER_TESTS === '1'");
    // The gate has to actually reach the describe, not just be computed.
    expect(src).toMatch(/describe\.skipIf\(\s*!live\b/);
  });

  // The real PG17 -> PG18 migration is live for a different reason: it downloads
  // the ~25 MB old engine from the npm registry and boots two Postgres WASM
  // clusters. Same hazard as the renders — left ungated it would make `npm test`
  // network-dependent — so it gets the same treatment under its own flag.
  const LIVE_MIGRATION_TEST = 'tests/integration/db/major-migration.test.ts';

  it('the live migration test gates on GLASSBOX_LIVE_MIGRATION_TESTS', () => {
    const src = read(LIVE_MIGRATION_TEST);
    expect(src).toContain("process.env.GLASSBOX_LIVE_MIGRATION_TESTS === '1'");
    expect(src).toMatch(/describe\.skipIf\(\s*!live\b/);
  });

  it('the default vitest config sets neither live gate', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).not.toContain('GLASSBOX_LIVE_RENDER_TESTS');
    expect(cfg).not.toContain('GLASSBOX_LIVE_MIGRATION_TESTS');
  });

  it('the live config sets both gates and disables file parallelism', () => {
    const cfg = read('vitest.config.live.ts');
    expect(cfg).toContain('GLASSBOX_LIVE_RENDER_TESTS');
    expect(cfg).toContain('GLASSBOX_LIVE_MIGRATION_TESTS');
    expect(cfg).toContain('fileParallelism: false');
    for (const rel of [...LIVE_TESTS, LIVE_MIGRATION_TEST]) expect(cfg).toContain(rel);
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

describe('smoke scripts bind an overridable, pre-checked port', () => {
  // Every smoke server runs with --strict-port, so a port already held by an
  // unrelated local service killed the run with a raw Node `listen EADDRINUSE`
  // stack dump that read as "the bundle is broken". The scripts must route the
  // port through the shared resolver, which both honors an override and fails
  // with a message naming the port.
  const SMOKE_SCRIPTS = ['smoke-test.sh', 'difftool-accumulate.sh', 'ground-truth.sh'];

  it('no smoke script hardcodes its port as a bare assignment', () => {
    for (const name of SMOKE_SCRIPTS) {
      const src = read(join('tests', 'smoke', name));
      expect(src, `${name} must not assign a literal port`).not.toMatch(/^PORT=\d+$/m);
      expect(src, `${name} must resolve its port via the shared helper`).toContain('smoke_resolve_port ');
    }
  });

  it('each smoke script names a distinct default port and override variable', () => {
    const defaults: string[] = [];
    const vars: string[] = [];
    for (const name of SMOKE_SCRIPTS) {
      const call = /smoke_resolve_port (\d+) (\w+)/.exec(read(join('tests', 'smoke', name)));
      expect(call, `${name} must call smoke_resolve_port <port> <ENV_VAR>`).not.toBeNull();
      defaults.push(call![1]);
      vars.push(call![2]);
    }
    // Distinct defaults keep the three suites runnable back-to-back; distinct
    // variables keep an override aimed at one from silently moving the others.
    expect(new Set(defaults).size).toBe(SMOKE_SCRIPTS.length);
    expect(new Set(vars).size).toBe(SMOKE_SCRIPTS.length);
  });
});
