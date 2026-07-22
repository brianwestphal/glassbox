---
name: technical-changelog
description: Generate a diff-grounded, one-page technical changelog for a Glassbox release — from the actual code changes between the last production tag and HEAD (the next, still-unreleased version). Asks for the next version number, since package.json holds the last release.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

Produce a **one-page technical report** of what changed for a release, stored in
`docs/technical-changelog/<base>-<next>.md`. The report must be grounded in the **real
diff** — added/modified/removed code, CLI-flag / requirements-doc / plugin / dependency
deltas — **not** commit messages or the requirements docs (`docs/*.md` and
`docs/ai/*.md` describe the *end state* and the *whole* feature history, so they routinely
credit the range with work that predates it, or describe posture that was already true).
Every claim is a verified delta between the base tag and HEAD.

## The two facts that make this skill necessary

1. **HEAD is the next, unreleased version.** `package.json` still holds the *last* released
   version (and it usually matches the base tag), so the release number can't be read from
   the repo — **you must ask the user** what the next planned version is.
2. **The base is always the most recent production release tag** (e.g. `v0.19.0`), and the
   range is `<base>..HEAD`. Pre-release tags (`-rc.1`, `-beta`) are never the base.

## Glassbox-specific traps (read these before writing)

- **The requirements docs (`docs/N-topic.md`, `docs/ai/*.md`, `CLAUDE.md`) describe the
  end state, not the range.** They are maintained in-sync and describe a whole subsystem as
  it stands — including parts that shipped in *earlier* releases. Treat them as leads to
  verify against the diff, never as sources to quote. A doc paragraph about "the plugin
  system" may span five releases; only the part that changed in `<base>..HEAD` belongs here.
- **Line counts are inflated by non-product churn.** `docs/`, `.claude`/`.hotsheet`
  scaffolding, `tauri build` output, and `assets/` fixtures are NOT engineering effort — the
  script separates a **product-only** total; lead with that.
- **A new *external* (non-bundled) server dependency is a three-place change** (doc-29 /
  CLAUDE.md "External Dependencies" rule: `tsup.config.ts` noExternal regex +
  `scripts/build-sidecar.sh` copy loop + CLAUDE.md list). A dep that appears only in
  `devDependencies` and is *bundled into a plugin* (e.g. `@viz-js/viz`, `@jsquash/*`) is
  deliberately NOT in that list — don't report it as a core dep.
- **Plugins build to git-ignored `plugins/<id>/index.js`.** The committed source is
  `plugins/<id>/{src,manifest.json,setup.mjs,README.md}`; the built `index.js` won't appear
  in a clean diff. Report the *source*.

## Steps

1. **Ask for the next release number first.** Use `AskUserQuestion` (or ask in prose):
   *"What's the next planned release version for this changelog?"* Do not guess and do not
   read it from `package.json` (that's the previous release). Accept e.g. `0.20.0` / `v0.20.0`.

2. **Run the analysis script** — it does the deterministic git work:
   ```bash
   node scripts/changelog-analysis.mjs --next <version>
   ```
   It auto-detects the base as the newest production `vX.Y.Z` tag that is an ancestor of
   HEAD, buckets the line delta **by area** (product: src / src-tauri / plugins / tests /
   scripts vs docs / scaffolding / generated), gives a **product-only** total, lists
   **added/removed** files and candidate **new subsystems**, and surfaces the Glassbox
   public-surface deltas: **new requirements docs**, **new first-party plugins**, **new
   API/route modules**, **CLI-flag** changes (`src/cli.ts`), and **dependency** changes.
   Override the base with `--base <tag>` only if the user asks (it warns if a newer
   production tag exists than the one it picked).

3. **Read the real diffs — do not stop at the script.** The script tells you *where* to
   look; the narrative comes from the actual changes. For each non-trivial area:
   ```bash
   git diff <base>..HEAD -- <path>          # what actually changed
   ```
   And **verify every "new" claim against the base tree** rather than trusting a commit
   subject or a requirements doc:
   ```bash
   git cat-file -e <base>:<file>            # non-zero exit → file is genuinely new
   git show <base>:<file> | grep -c <sym>   # 0 → the symbol/behavior was added in range
   git ls-tree -r --name-only <base> -- src/   # what the tree looked like at the base
   ```
   Classic traps to check: a subsystem that looks new but existed at the base; a feature
   added **and removed within the same range** (nets to zero at HEAD — say so); posture like
   "local-first / no network" / "zero core deps" that was **already true at the base**
   (baseline, not a change); a dependency bumped in **two hops** (report the full base→HEAD
   delta).

4. **Write the report** to `docs/technical-changelog/<base>-<next>.md` (the script prints
   the exact suggested path). Keep it to ~one page. It must contain, in this spirit:
   - **Header:** the range (`<base>..HEAD`), commit count, and a note that HEAD is untagged
     / the "next" number is a label. State it's derived from the diff, not commit prose.
   - **Honest size:** the area-by-area split from the script, and the **product-only**
     +/- total called out separately from the raw total (which is inflated by docs and
     `.claude`/`.hotsheet` scaffolding — never present the raw number as engineering effort).
   - **Baseline note:** one line on what already shipped at the base (so nothing
     pre-existing reads as new).
   - **Per-change sections** for the genuine deltas, each carrying its **diff evidence**
     (new files, the new requirements doc / plugin / API-module / dep delta, `0-hits →
     present` for behavior). Order by significance (a net-new subsystem before a doc sync).
   - **Mermaid diagrams as needed** (not gratuitously): a component/flow diagram for a new
     subsystem, a sequence diagram for a new round-trip/interaction. Use `<br/>` for line
     breaks in node labels (not `\n`) and quote labels containing spaces/punctuation.

5. **Validate + finish.**
   - Sanity-check the mermaid blocks (balanced `[]`/quotes; standard `flowchart` /
     `sequenceDiagram` syntax). If a renderer is available, render to confirm; otherwise a
     structural check is fine.
   - Re-read the draft against the script output and your `git show <base>:…` probes: is
     **every** claim a real delta? Cut or re-label anything that describes the baseline.
   - **American-English spelling** throughout (CLAUDE.md convention).
   - Committing is optional and follows the repo's git rules (commit when it's a clean unit;
     no `Co-Authored-By` trailer, no hard-wrapped body lines; never `git push` without
     explicit permission).

## Guardrails

- **Diff over prose.** If a claim isn't backed by a file/line change you actually read,
  don't make it. Commit subjects and `docs/` are leads to verify, not sources to quote.
- **Never inflate.** Lead with product-only line counts; label docs and agent/skill
  scaffolding as non-engineering.
- **Attribute to the range only.** When unsure whether something is new, run the
  `git cat-file -e <base>:<file>` / `git show <base>:<file>` probe before writing it up.
