#!/usr/bin/env tsx
/**
 * check-features — feature/requirement coverage report.
 *
 * A coverage axis orthogonal to line/branch coverage. Line coverage proves
 * every *line ran*; it says nothing about whether every documented *behavior*
 * (or every *sequence* of behaviors) is actually *asserted*. Bugs that live in
 * an untested interaction or state transition slip through a green 100% report,
 * because the individual lines still get hit by isolated tests.
 *
 * This tool walks the requirement units enumerated in `docs/[0-9]*.md` and, per
 * unit, asks: *is there a test that would fail if this behavior regressed?* It
 * cross-references each unit against the coverage map in
 * `docs/testing/feature-coverage.json` and flags:
 *   - units with NO map entry, or an entry with no asserting test;
 *   - stateful units (marked `stateful: true`) whose entry lists no state
 *     transitions — untested transitions are the exact gap line coverage is
 *     structurally blind to.
 *
 * Advisory by default (exit 0, prints the report). Pass `--strict` to exit
 * non-zero when any gap remains — for wiring into a pre-commit/CI gate once the
 * map is fully populated.
 *
 * The pure functions (`extractRequirementUnits`, `findCoverageGaps`) are
 * exported and unit-tested in `tests/unit/scripts/check-features.test.ts`.
 */
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/** One documented requirement unit extracted from a requirements doc. */
export interface RequirementUnit {
  /** Stable id: an `FR-N.M` / `NFR-N.M` bold id, or a `N.M` subsection number. */
  id: string;
  /** Human-readable title (heading text or the bold-id label). */
  title: string;
  /** Doc number the unit came from (e.g. 24). */
  doc: number;
}

/** A coverage-map entry for a single requirement unit. */
export interface CoverageEntry {
  /** Test file paths / test names that would fail if the behavior regressed. */
  tests?: string[];
  /** True if the unit describes a stateful module (modes / phases / lifecycle). */
  stateful?: boolean;
  /**
   * For stateful units: the state transitions asserted by tests (e.g.
   * "reopen after complete", "clear then refill"). A stateful unit with no
   * transitions listed is a gap even when `tests` is non-empty.
   */
  transitions?: string[];
  /** Free-form note. */
  note?: string;
}

export interface CoverageMap {
  version: number;
  units: Record<string, CoverageEntry>;
}

/** A detected coverage gap. */
export interface CoverageGap {
  id: string;
  title: string;
  doc: number;
  reason: 'unmapped' | 'no-test' | 'stateful-no-transitions';
}

const FR_ID_RE = /\*\*(FR|NFR)-(\d+(?:\.\d+)*[a-z]?)/g;
const SUBSECTION_RE = /^#{3,4}\s+(\d+(?:\.\d+)+[a-z]?)\s+(.+?)\s*$/;

/**
 * Extract the requirement units from one requirements doc's markdown.
 *
 * Two doc styles coexist in this project, so both are supported:
 *   - Newer docs use explicit bold ids: `**FR-24.1 — Mode.** ...`
 *   - Older docs enumerate behaviors as numbered subsections: `### 1.1 Review Creation`
 *
 * When a doc uses explicit `FR-`/`NFR-` ids, those are authoritative and the
 * subsection headings are ignored (they are just section groupings there).
 * Otherwise the numbered subsections are the units. This keeps every doc
 * indexable without retrofitting ids into the older ones.
 */
export function extractRequirementUnits(markdown: string, doc: number): RequirementUnit[] {
  const units: RequirementUnit[] = [];
  const seen = new Set<string>();

  // First pass: explicit FR-/NFR- ids.
  for (const m of markdown.matchAll(FR_ID_RE)) {
    const id = `${m[1]}-${m[2]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // Title: text after the id up to the next `.` or `—`/`-` delimiter, best-effort.
    const after = markdown.slice(m.index + m[0].length);
    const titleMatch = after.match(/^\s*(?:[—-]\s*)?([^.\n*]+)/);
    const title = titleMatch ? titleMatch[1].trim() : id;
    units.push({ id, title, doc });
  }

  if (units.length > 0) return units;

  // Fallback: numbered subsection headings (older docs).
  for (const line of markdown.split('\n')) {
    const m = line.match(SUBSECTION_RE);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    units.push({ id, title: m[2].trim(), doc });
  }

  return units;
}

/** Compute the coverage gaps for a set of requirement units against a map. */
export function findCoverageGaps(units: RequirementUnit[], map: CoverageMap): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const unit of units) {
    const entry = map.units[unit.id];
    if (!entry) {
      gaps.push({ ...unit, reason: 'unmapped' });
      continue;
    }
    if (!entry.tests || entry.tests.length === 0) {
      gaps.push({ ...unit, reason: 'no-test' });
      continue;
    }
    if (entry.stateful && (!entry.transitions || entry.transitions.length === 0)) {
      gaps.push({ ...unit, reason: 'stateful-no-transitions' });
    }
  }
  return gaps;
}

/** Read every `docs/N-*.md` requirements doc and extract its units. */
export function loadAllRequirementUnits(docsDir: string): RequirementUnit[] {
  const units: RequirementUnit[] = [];
  const files = readdirSync(docsDir)
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b));
  for (const file of files) {
    const doc = parseInt(file);
    const md = readFileSync(join(docsDir, file), 'utf8');
    units.push(...extractRequirementUnits(md, doc));
  }
  return units;
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const docsDir = join(root, 'docs');
  const mapPath = join(docsDir, 'testing', 'feature-coverage.json');

  const units = loadAllRequirementUnits(docsDir);
  let map: CoverageMap;
  try {
    map = JSON.parse(readFileSync(mapPath, 'utf8')) as CoverageMap;
  } catch {
    map = { version: 1, units: {} };
  }

  const gaps = findCoverageGaps(units, map);
  const mapped = units.length - gaps.filter((g) => g.reason === 'unmapped').length;

  const REASON_LABEL: Record<CoverageGap['reason'], string> = {
    unmapped: 'no coverage-map entry',
    'no-test': 'entry lists no asserting test',
    'stateful-no-transitions': 'stateful module with no transition tests listed',
  };

  console.log('Feature / requirement coverage report');
  console.log('=====================================');
  console.log(`Requirement units found:   ${units.length}`);
  console.log(`Units with a map entry:    ${mapped}`);
  console.log(`Gaps (behavior with no asserting test): ${gaps.length}`);
  console.log('');

  if (gaps.length > 0) {
    const byDoc = new Map<number, CoverageGap[]>();
    for (const g of gaps) {
      const arr = byDoc.get(g.doc) ?? [];
      arr.push(g);
      byDoc.set(g.doc, arr);
    }
    for (const doc of [...byDoc.keys()].sort((a, b) => a - b)) {
      console.log(`docs/${doc}-*.md:`);
      for (const g of byDoc.get(doc)!) {
        console.log(`  - ${g.id}  ${g.title}  [${REASON_LABEL[g.reason]}]`);
      }
    }
    console.log('');
    console.log(
      'Each gap above is a documented behavior with no test that would fail if it regressed.',
    );
    console.log(
      'Fill in docs/testing/feature-coverage.json (see docs/testing/feature-coverage.md).',
    );
  } else {
    console.log('No gaps: every documented behavior has at least one asserting test.');
  }

  if (strict && gaps.length > 0) process.exit(1);
}

// Run only when invoked directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
