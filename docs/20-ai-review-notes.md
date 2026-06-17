# 20. AI-Authored Review Notes

Requirements for a line-anchored, AI-authored "review companion" that travels
with the code: as an AI generates or modifies code, it emits structured notes
explaining *why* each non-obvious change is the way it is and *what proves it
correct*, anchored to specific files and line ranges. Glassbox renders those
notes alongside the diff so a reviewer reads the author's reasoning at the exact
line it applies to, rather than reconstructing it from prose in a ticket or
commit message.

> **Status: Design only (not yet implemented).** This document captures the
> agreed direction. Implementation is tracked as separate phased tickets. The
> phasing is summarized in §20.11.

## Motivation

Ticket notes and commit messages capture intent at the *change* level ("added
per-step timeouts, here's why"). Review happens at the *line* level: at line N a
reviewer wants to know why this line, what alternatives were rejected, and what
demonstrates the change is correct (the test that ran, a before/after
screenshot, a measurement). Today that context exists in the model's head at
edit time and is thrown away. AI-Authored Review Notes give the generating AI a
structured, line-anchored channel to record it, and give the reviewer (human or
another AI) an optimized way to consume it.

## Functional Requirements

### 20.1 Storage location

- **Dedicated committed directory** — Review notes shall live in a dedicated
  top-level directory, `<repo>/.pr-notes/`, committed alongside the code.
- **Not under `.glassbox/`** — Notes shall NOT live under `.glassbox/`. That
  directory holds tool-managed local state (PGLite exports, etc.) and is
  commonly gitignored; review notes are durable project content and must travel
  with the repository.
- **Never gitignored by the tool** — Glassbox shall not auto-suggest adding
  `.pr-notes/` to `.gitignore` (contrast with its existing `.glassbox/`
  gitignore prompt), and should warn if `.pr-notes/` is found to be ignored,
  since an ignored notes directory silently defeats the feature.
- **Tool-neutral** — The directory and file format shall not depend on Glassbox
  to be meaningful; any tool or human browsing the repo can read them.

### 20.2 File format — SARIF 2.1.0

- **SARIF as the on-disk format** — Each notes file shall be a valid
  [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/) JSON document
  (`.pr-notes/*.sarif`). SARIF is reused rather than inventing a bespoke schema
  because it already models region-anchored results with fingerprints,
  attachments, provenance, and code flows, and has broad tooling support
  (GitHub code scanning, the VS Code SARIF Viewer, Azure DevOps, many scanners).
- **One note = one SARIF `result`.** The mapping from a note to SARIF fields:
  - **Anchor** → `result.locations[].physicalLocation.region`
    (`startLine`/`startColumn`/`endLine`/`endColumn`, plus `charOffset`/
    `charLength` and an embedded `snippet`).
  - **Symbol fallback** → `logicalLocations[]` (`fullyQualifiedName`, `kind`).
  - **Durable re-anchoring** → `result.partialFingerprints` (see §20.3).
  - **Stale vs current** → `result.baselineState`
    (`new` / `unchanged` / `updated` / `absent`).
  - **Baseline commit** → `run.versionControlProvenance[]` (`repositoryUri`,
    `revisionId`, `branch`).
  - **Body** → `result.message.markdown`.
  - **Importance / risk** → `result.rank` (0–100) and `result.level`.
  - **Proposed change** → `result.fixes[]`.
  - **Narrative / sequence** → `codeFlows` / `threadFlows`.
- **Note kind** — Each note shall carry a kind from a controlled vocabulary:
  `rationale`, `proof`, `assumption`, `alternative-considered`, `risk`,
  `test-evidence`. Because SARIF is finding-oriented, notes use
  `result.kind: "informational"` (or `"review"`) and record the GB note kind,
  `confidence` (0–1), and ticket links in `result.properties`.
- **Findings-orientation caveat** — SARIF's ecosystem viewers render results as
  *problems*; they will not present these informational notes as a review
  companion. Glassbox supplies that view itself (§20.6). The format is reused
  for its anchoring/provenance model and interoperability, not for third-party
  rendering.

### 20.3 Anchoring and durability

- **Anchor to an immutable baseline** — Each note shall record the commit it was
  authored against (`versionControlProvenance.revisionId`) plus the region at
  author time, so the anchor references a fixed point even as the working tree
  moves on.
- **Content fingerprint** — Each note shall carry `partialFingerprints` derived
  from the normalized anchored text, so it can be re-located after surrounding
  edits shift line numbers.
- **Re-match through the existing stale machinery** — When Glassbox loads notes
  against the current tree, it shall re-anchor them using the same
  match-or-mark-stale logic it already applies to human annotations: a matched
  note renders at its current line; an unmatchable note is flagged stale
  (`baselineState: absent`) for the reviewer to keep or discard.

### 20.4 Authoring

Authoring shall support a combined live-plus-coalesce flow (not either/or):

- **Live, incremental authoring** — As the AI edits, it shall be able to emit
  notes in place via an MCP channel tool (working name
  `glassbox_attach_review_note`), at the moment of richest context, rather than
  reconstructing reasoning after the fact.
- **Revision and correction** — The AI shall be able to update or remove its own
  earlier notes as the work evolves, so notes reflect the final state of the
  change rather than an obsolete intermediate step.
- **Final coalescing pass** — On completion, a consolidation pass shall reduce
  unhelpful verbosity (merging or dropping redundant notes) and surface
  cross-cutting relationships that weren't visible while editing a single file
  (linking related notes across files).
- **Inbound AI-instructions contract** — Glassbox already ships *outbound* AI
  instructions in its markdown export ("here's how to act on annotations"). This
  feature adds the symmetric *inbound* contract: a documented, adoptable
  instruction set (skill / `CLAUDE.md` snippet) telling a generating AI when and
  how to emit review notes. See §20.7 for the cross-tool obligation.

### 20.5 Artifacts

- **Text artifacts committed as text** — Proof artifacts that are text shall be
  stored as text and committed: diagrams as *source* (Mermaid / Graphviz /
  PlantUML — never rendered images), plus test output, logs, perf numbers, and
  command transcripts. They are referenced from a note via
  `artifactLocation.uri` (relative path under `.pr-notes/`).
- **Binary artifacts via Git LFS** — Genuinely binary artifacts (screenshots)
  shall be stored under `.pr-notes/artifacts/` and tracked with Git LFS (e.g.
  `.gitattributes`: `.pr-notes/artifacts/**/*.{png,webp,avif} filter=lfs
  diff=lfs merge=lfs -text`), so the main repository history stays lean while
  artifacts remain versioned and portable. Each is referenced by
  `artifactLocation.uri` and recorded with `artifact.hashes` (sha-256) for
  verification; binary bytes are never inlined via `artifact.contents`.
- **Minimize binaries** — Authors shall prefer text/diagram-source over images,
  downscale and compress screenshots (WebP/AVIF), and attach one artifact per
  *claim* rather than per step, to avoid bloating history even under LFS.

### 20.6 Viewing in Glassbox

- **Rendered like review comments** — Notes shall be presented primarily the way
  existing line-level review comments are, anchored in the diff at their line,
  not in a separate side pane.
- **Visually distinct as AI-authored** — Notes shall be styled distinctly so it
  is immediately apparent they are AI-authored review companions rather than the
  reviewer's own annotations — following the precedent of the guided-review
  presentation. An annotation source flag (`ai` vs `human`) shall drive this.
- **Kind-aware surfacing** — Note kinds shall map onto existing surfaces where
  natural: `risk` / `assumption` can seed the risk dimensions; an author-stated
  reading order can seed narrative ordering; `rationale` reads like
  guided-review educational text.
- **Artifact rendering** — Diagram-source artifacts render inline (Mermaid),
  screenshots render through the existing image-diff component, and test output
  renders as a code block.
- **Threading** — A reviewer shall be able to reply to an AI note with their own
  annotation, turning a note into a line-anchored conversation.

### 20.7 Cross-tool integration (Hot Sheet and other orchestrators)

- **Induce production of notes** — For the feature to deliver value, the tools
  that drive AI coding work (Hot Sheet, and other agent orchestrators) must
  instruct and encourage the AI to produce review notes as part of its normal
  process, not as an afterthought. This obligation lives partly outside
  Glassbox; it is tracked as a corresponding Hot Sheet ticket.
- **Ticket ↔ notes linkage** — A note may reference the ticket that produced it
  (`result.properties`), and a ticket-tracking tool may surface the proof
  artifacts a ticket's work produced, so "what changed and why" (ticket level)
  gains "and here is the proof, at these lines" (note level).

### 20.8 Summarization and round-trip

- **Machine- and human-readable** — Notes shall be machine-parseable (SARIF
  JSON) and human-readable (markdown bodies).
- **AI-summarizable** — Glassbox's existing AI analysis shall be able to ingest
  the notes file to produce a review summary, to pre-seed risk/narrative
  analysis from the author's own stated risks and assumptions, and to fold note
  content into the existing `.glassbox/latest-review.md` export. The notes thus
  serve as both an input to review and a byproduct the next AI session can read.

## Non-Functional Requirements

### 20.9 Interoperability

- **Valid SARIF** — Notes files shall validate against the SARIF 2.1.0 schema so
  third-party SARIF tooling can at least parse them, even though it will not
  render them as a review companion.

### 20.10 Repository hygiene

- **Lean committed footprint** — The committed footprint shall be text (the
  SARIF manifest plus diagram source). Binary artifacts shall go through Git LFS
  rather than into the packfile history (§20.5).
- **No source pollution** — Notes shall never be written as inline comments in
  source files; they live beside the code, not in it.

### 20.11 Phasing

Implementation is expected to proceed in slices, each tracked as its own ticket:

- **P1** — Define the `.pr-notes/` SARIF schema/profile and a channel MCP tool to
  write notes (smallest end-to-end slice).
- **P2** — Ingest and render notes as a distinct, review-comment-style
  annotation source in the diff view.
- **P3** — Anchor durability via fingerprint re-matching (reuse the stale
  matcher).
- **P4** — Artifact rendering (diagram source / screenshot via image-diff / test
  output) and the Git LFS wiring.
- **P5** — Feed notes into the existing risk/narrative analysis and the markdown
  export.
- **Cross-cutting** — The inbound AI-instructions contract (§20.4) and the Hot
  Sheet-side obligation to induce note production (§20.7).

## Maintenance triggers

Update this document when: the storage location or directory name changes; the
SARIF profile (fields used, note-kind vocabulary, property keys) changes; the
authoring tool surface changes; the rendering model changes; or the artifact
storage policy changes. When any phase ships, update its status here and in
`docs/ai/requirements-summary.md`.
