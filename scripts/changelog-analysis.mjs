#!/usr/bin/env node
/**
 * Deterministic git analysis for a technical changelog (see the
 * `technical-changelog` skill). Grounds the report in the *actual* diff, not
 * commit prose: it finds the base tag, buckets the line delta by area
 * (product vs docs vs scaffolding vs generated assets), classifies files
 * added/modified/removed, and surfaces the concrete public-surface deltas
 * (CLI flags, new requirements docs / plugins / API modules, dependencies)
 * plus "is this genuinely new?" probes.
 *
 *   node scripts/changelog-analysis.mjs [--base <tag>] [--next <version>]
 *
 * --base   Override the auto-detected base tag (default: the most recent
 *          production release tag reachable from HEAD, pre-releases excluded).
 * --next   The next planned release number (HEAD is unreleased, so this can't
 *          be read from package.json). Only used to suggest the output path.
 *
 * Prints a human-readable report to stdout. Writes nothing — the skill reads
 * this, then reads the real per-file diffs, then authors the document.
 *
 * Modeled on ~/Documents/apple-fm's scripts/changelog-analysis.mjs, adapted to
 * Glassbox's layout (TypeScript app + Tauri Rust + first-party plugins) and its
 * public surface (CLI flags in src/cli.ts, numbered requirements docs, plugins,
 * the typed src/api/ layer).
 */
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function gitOk(args) {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') out.base = argv[++i];
    else if (argv[i] === '--next') out.next = argv[++i];
    else if (argv[i] === '--head') out.head = argv[++i];
  }
  return out;
}

/** Semver-ish compare for tags like `v1.2.3` (pre-releases sort lower). */
function cmpTag(a, b) {
  const norm = (t) => t.replace(/^v/, '');
  const [av, ap = '~'] = norm(a).split('-');
  const [bv, bp = '~'] = norm(b).split('-');
  const ap2 = av.split('.').map(Number);
  const bp2 = bv.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((ap2[i] || 0) !== (bp2[i] || 0)) return (ap2[i] || 0) - (bp2[i] || 0);
  }
  // no pre-release ('~') outranks a pre-release ('-rc.1') at the same version
  return ap < bp ? -1 : ap > bp ? 1 : 0;
}

/**
 * The most recent *production* release tag that is an ancestor of HEAD.
 * Production = a `vX.Y.Z` tag with no pre-release suffix (`-rc.1`, `-beta`, …).
 */
function latestProductionTag(head) {
  const tags = git(['tag', '--list', 'v*'])
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t)) // strict production semver, no suffix
    .filter((t) => gitOk(['merge-base', '--is-ancestor', t, head]) !== null);
  tags.sort(cmpTag);
  return tags.length > 0 ? tags[tags.length - 1] : null;
}

/** Classify a changed path into a reporting area + whether it's product code. */
function classify(path) {
  // Generated / build output first (some live under otherwise-product dirs).
  if (/^dist\//.test(path)) return { area: 'dist (generated)', product: false };
  if (/^src-tauri\/(gen|target)\//.test(path)) return { area: 'tauri build (generated)', product: false };
  if (/^(coverage|playwright-report|test-results)\//.test(path)) return { area: 'test output (generated)', product: false };
  // First-party plugins: the committed source is plugins/<id>/{src,manifest.json,setup.mjs,README}.
  if (/^plugins\/[^/]+\/index\.js$/.test(path)) return { area: 'plugins (built, git-ignored)', product: false };
  if (/^plugins\//.test(path)) return { area: 'first-party plugins', product: true };
  // Product source.
  if (/^src-tauri\//.test(path)) return { area: 'src-tauri (Rust desktop)', product: true };
  if (/^src\//.test(path)) return { area: 'src (app)', product: true };
  if (/^tests\//.test(path)) return { area: 'tests', product: true };
  if (/^scripts\//.test(path)) return { area: 'scripts', product: true };
  // Non-product.
  if (/^(assets|ground-truth-screenshots)\//.test(path)) return { area: 'assets (fixtures/generated)', product: false };
  if (/^docs\//.test(path)) return { area: 'docs', product: false };
  if (/^\.(claude|agents|hotsheet|cursor)\//.test(path)) return { area: 'agent/skill scaffolding', product: false };
  if (/^\.github\//.test(path)) return { area: 'CI', product: false };
  return { area: 'other (README/config)', product: false };
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padL(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

/** New/removed `--flag` tokens between base and HEAD in a given file. */
function flagDeltaFor(range, file, head) {
  if (gitOk(['cat-file', '-e', `${head}:${file}`]) === null) return null;
  const added = new Set();
  const removed = new Set();
  for (const l of git(['diff', range, '--', file]).split('\n')) {
    const m = [...l.matchAll(/--[a-z][a-z-]+/g)].map((x) => x[0]);
    if (/^\+/.test(l) && !/^\+{3}/.test(l)) m.forEach((f) => added.add(f));
    if (/^-/.test(l) && !/^-{3}/.test(l)) m.forEach((f) => removed.add(f));
  }
  return { net: [...added].filter((f) => !removed.has(f)), gone: [...removed].filter((f) => !added.has(f)) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const head = args.head ?? 'HEAD';
  const base = args.base ?? latestProductionTag(head);

  if (base === null) {
    console.error(
      'No production release tag (vX.Y.Z) found as an ancestor of HEAD.\n' +
        'Pass one explicitly with --base <tag>.',
    );
    process.exit(1);
  }

  const range = `${base}..${head}`;
  const baseInfo = git(['log', '-1', '--format=%h %ci %s', base]).trim();
  const headInfo = git(['log', '-1', `--format=%h %ci %s`, head]).trim();
  const commitCount = git(['rev-list', '--count', range]).trim();

  // All production tags, to warn if a newer one exists that isn't the base.
  const allProd = git(['tag', '--list', 'v*'])
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .sort(cmpTag);
  const newestProd = allProd[allProd.length - 1];

  // numstat by area (--no-renames so a rename reads as delete+add and classifies cleanly)
  const numstat = git(['diff', '--numstat', '--no-renames', range])
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [add, del, ...rest] = l.split('\t');
      return { add: Number(add) || 0, del: Number(del) || 0, path: rest.join('\t') };
    });

  const areas = new Map();
  let prodAdd = 0;
  let prodDel = 0;
  let totAdd = 0;
  let totDel = 0;
  for (const { add, del, path } of numstat) {
    const { area, product } = classify(path);
    const a = areas.get(area) ?? { files: 0, add: 0, del: 0, product };
    a.files++;
    a.add += add;
    a.del += del;
    areas.set(area, a);
    totAdd += add;
    totDel += del;
    if (product) {
      prodAdd += add;
      prodDel += del;
    }
  }

  // A/M/D classification
  const status = git(['diff', '--name-status', '--no-renames', range])
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [st, ...rest] = l.split('\t');
      return { st: st[0], path: rest.join('\t') };
    });
  const added = status.filter((s) => s.st === 'A').map((s) => s.path);
  const removed = status.filter((s) => s.st === 'D').map((s) => s.path);

  // New product source files (candidate "genuinely new subsystems").
  const newProduct = added.filter((p) => classify(p).product && /\.(ts|tsx|rs|mjs|js|scss)$/.test(p));
  // Glassbox-specific "new area" signals.
  const newReqDocs = added.filter((p) => /^docs\/\d+[-.].*\.md$/.test(p));
  const newPlugins = added.filter((p) => /^plugins\/[^/]+\/manifest\.json$/.test(p)).map((p) => p.split('/')[1]);
  const newApiModules = added.filter((p) => /^src\/(api|routes(\/api)?)\/[^/]+\.tsx?$/.test(p));

  // CLI flag delta — Glassbox parses flags in src/cli.ts (and the difftool bridge).
  const flags = flagDeltaFor(range, 'src/cli.ts', head);
  const difftoolFlags = flagDeltaFor(range, 'src/cli-difftool.ts', head);

  // Dependency changes (package.json dependencies + devDependencies).
  let depDelta = null;
  if (gitOk(['cat-file', '-e', `${head}:package.json`]) !== null) {
    const readDeps = (ref) => {
      try {
        const pj = JSON.parse(git(['show', `${ref}:package.json`]));
        return { dep: pj.dependencies ?? {}, dev: pj.devDependencies ?? {} };
      } catch {
        return { dep: {}, dev: {} };
      }
    };
    const b = readDeps(base);
    const h = readDeps(head);
    const changed = [];
    for (const scope of ['dep', 'dev']) {
      for (const k of new Set([...Object.keys(b[scope]), ...Object.keys(h[scope])])) {
        if (b[scope][k] !== h[scope][k]) {
          changed.push(`[${scope === 'dep' ? 'dependencies' : 'devDependencies'}] ${k}: ${b[scope][k] ?? '(none)'} → ${h[scope][k] ?? '(removed)'}`);
        }
      }
    }
    depDelta = changed;
  }

  // ---- print ----
  const L = [];
  L.push('# Technical Changelog Analysis');
  L.push('');
  L.push(`Base tag (auto):   ${base}   [${baseInfo}]`);
  L.push(`Head:              ${head}   [${headInfo}]`);
  L.push(`Range:             ${range}   (${commitCount} commits)`);
  L.push(`Next version:      ${args.next ?? '(NOT PROVIDED — the skill must ask the user)'}`);
  if (args.next) L.push(`Suggested output:  docs/technical-changelog/${base}-v${String(args.next).replace(/^v/, '')}.md`);
  if (newestProd && newestProd !== base) {
    L.push('');
    L.push(`WARNING: a newer production tag exists (${newestProd}) but is not the base — confirm ${base} is intended.`);
  }
  L.push('');
  L.push('## Line delta by area  (raw total is misleading — split product vs not)');
  L.push('');
  L.push(`  ${pad('area', 32)} ${padL('files', 6)} ${padL('+add', 8)} ${padL('-del', 8)}  product`);
  const sorted = [...areas.entries()].sort((a, b) => b[1].add - a[1].add);
  for (const [area, a] of sorted) {
    L.push(`  ${pad(area, 32)} ${padL(a.files, 6)} ${padL('+' + a.add, 8)} ${padL('-' + a.del, 8)}  ${a.product ? 'yes' : '—'}`);
  }
  L.push('');
  L.push(`  TOTAL (raw):        +${totAdd} / -${totDel}   across ${numstat.length} files`);
  L.push(`  PRODUCT CODE ONLY:  +${prodAdd} / -${prodDel}   (src + src-tauri + plugins + tests + scripts)`);
  L.push(`  -> In the report, lead with product-only; label docs/scaffolding separately.`);
  L.push('');
  L.push(`## Files: ${added.length} added, ${removed.length} removed, ${status.length - added.length - removed.length} modified`);
  L.push('');
  L.push('New product source files (candidate NEW subsystems — verify absent at base):');
  if (newProduct.length === 0) L.push('  (none)');
  for (const p of newProduct) L.push(`  A  ${p}`);
  if (removed.length > 0) {
    L.push('');
    L.push('Removed files:');
    for (const p of removed) L.push(`  D  ${p}`);
  }
  L.push('');
  L.push('## New "functional area" signals (Glassbox-specific)');
  L.push(`  New requirements docs (docs/N-topic.md): ${newReqDocs.length ? newReqDocs.join(', ') : '(none)'}`);
  L.push(`  New first-party plugins (plugins/<id>/): ${newPlugins.length ? newPlugins.join(', ') : '(none)'}`);
  L.push(`  New API/route modules:                   ${newApiModules.length ? newApiModules.join(', ') : '(none)'}`);
  L.push('');
  L.push('## CLI flag delta (src/cli.ts)');
  if (flags) {
    L.push(`  added:   ${flags.net.length ? flags.net.join(', ') : '(none)'}`);
    L.push(`  removed: ${flags.gone.length ? flags.gone.join(', ') : '(none)'}`);
  } else {
    L.push('  (src/cli.ts not found)');
  }
  if (difftoolFlags && (difftoolFlags.net.length || difftoolFlags.gone.length)) {
    L.push(`  difftool bridge (src/cli-difftool.ts): +[${difftoolFlags.net.join(', ')}] -[${difftoolFlags.gone.join(', ')}]`);
  }
  L.push('');
  L.push('## Dependency changes (package.json)');
  if (depDelta && depDelta.length > 0) {
    for (const d of depDelta) L.push(`  ${d}`);
    L.push('  NOTE: a new *external* (non-bundled) server dep must touch THREE places (tsup.config.ts');
    L.push('        noExternal regex + scripts/build-sidecar.sh copy loop + CLAUDE.md) — verify in the diff.');
  } else {
    L.push('  (none)');
  }
  L.push('');
  L.push('## Next steps for the author (do NOT stop here)');
  L.push('  1. For each area above, READ THE REAL DIFF: `git diff ' + range + ' -- <path>`.');
  L.push('  2. Verify each "new" claim against the base tree, e.g.');
  L.push('       `git cat-file -e ' + base + ':<file>`  (absent -> genuinely new)');
  L.push('       `git show ' + base + ':<file> | grep -c <symbol>`  (0 -> added in range)');
  L.push('  3. Note what already shipped at ' + base + ' (baseline, NOT a change).');
  L.push('  4. Write docs/technical-changelog/' + base + '-v<next>.md, grounded in the diff.');
  console.log(L.join('\n'));
}

main();
