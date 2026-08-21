# 20. AI-Authored Review Notes

Requirements for a line-anchored, AI-authored "review companion" that travels
with the code: as an AI generates or modifies code, it emits structured notes
explaining *why* each non-obvious change is the way it is and *what proves it
correct*, anchored to specific files and line ranges. Glassbox renders those
notes alongside the diff so a reviewer reads the author's reasoning at the exact
line it applies to, rather than reconstructing it from prose in a ticket or
commit message.

> **Status: Substantially shipped (P1–P5).** The `.pr-notes/` SARIF format and
> the producer-side `glassbox note` CLI (P1), the diff-anchored reader/render
> with threading and markdown bodies (P2), load-time re-anchoring of stale notes
> (P3), artifact attachment with inline text/image rendering (P4), and folding
> notes into AI analysis + export (P5) are all built. Live *diagram* rendering
> of diagram-source artifacts (Mermaid/Graphviz/PlantUML) into actual images
> shipped via the content-plugin system (doc 29) — with the matching plugin
> installed the artifact renders inline as a diagram; without it, the source
> falls soft to a code block. Per-phase status is in §20.11.

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
- **Layout — sharded by source-file path.** Notes shall be stored at
  `.pr-notes/notes/<repo-relative source path>.NNNNNN.sarif`, one (or more) SARIF
  log per source file mirroring the repo tree (e.g.
  `.pr-notes/notes/src/ai/client.ts.000000.sarif`). This optimizes the dominant
  read — "the notes for the files in *this* review" — to exactly the changed
  files' note files, never a full scan, even as a large repo accumulates
  millions of records. The zero-padded `NNNNNN` index caps any single file's
  notes at a default of **10,000 results per shard** and rolls to the next index
  when full, bounding the size for hot, frequently-edited files. (Commit/date
  sharding was rejected: Glassbox reviews are file/diff-oriented and span
  uncommitted/staged/branch ranges that don't map to one commit; commit
  provenance is still recorded *inside* each result, so per-commit views remain
  possible via a walk/index later.)

### 20.2 File format — SARIF 2.1.0

- **SARIF as the on-disk format** — Each notes file shall be a valid
  [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/) JSON document
  (`.pr-notes/*.sarif`). SARIF is reused rather than inventing a bespoke schema
  because it already models region-anchored results with fingerprints,
  attachments, provenance, and code flows, and has broad tooling support
  (GitHub code scanning, the VS Code SARIF Viewer, Azure DevOps, many scanners).
- **One note = one SARIF `result`.** The mapping from a note to the SARIF
  fields **currently emitted** by the reference writer (`buildResult` in
  `src/review-notes/sarif.ts`):
  - **Anchor** → `result.locations[].physicalLocation.region` — currently
    `startLine`/`endLine` plus an embedded `snippet`.
  - **Durable re-anchoring** → `result.partialFingerprints` (see §20.3).
  - **Baseline commit** → `run.versionControlProvenance[]` (`repositoryUri`,
    `revisionId`, `branch`).
  - **Body** → `result.message.markdown` (the GitHub-Flavored Markdown form,
    SARIF §3.11.4) with `result.message.text` as the plain-text fallback SARIF
    §3.11.9 requires alongside it. **Reading precedence:** the reader takes
    `markdown ?? text`. Only a consumer that *cannot* render formatted
    text is required to fall back to `text`; Glassbox renders markdown (§20.6),
    so a producer that writes a spec-correct plain/rich pair keeps its
    formatting instead of having it silently discarded. The same precedence
    governs the `coalesce` redundancy check, so two notes that render
    differently are never collapsed into one. **Writing:** the reference writer
    emits the body verbatim as `markdown` and a *flattened* plain-text rendering
    as `text` (`src/utils/flattenMarkdown.ts` — heading markers and inline
    emphasis dropped, code fences removed while their contents survive, links
    reduced to `text (url)`; list, blockquote, and thematic-break markers are
    kept because they read as intended unrendered). Duplicating the markdown
    source into both fields would defeat §3.11.9's stated purpose for `text`, so
    a third-party SARIF viewer sees prose rather than raw `###` and `**`.
  - **Importance / risk** → `result.rank` (0–100) and `result.level` (`warning`
    for the `risk` kind, `none` otherwise).
  - **Producer identity** → `run.tool.driver.name` / `.version` — Claude Code,
    Hot Sheet, etc.; the standard "who produced this run" slot (Glassbox is the
    *consumer*, not the producer, so it does not appear here).
  - **Linked ticket** → `result.workItemUris` (standard SARIF work-item link).
  - **Attachments** → `result.attachments[]` (artifact URIs, each with an
    `ext-sha256` property for verification).
  - **Linked code locations** → `result.relatedLocations[]` (each an
    `artifactLocation.uri` + `region.startLine`, with `id` set to its index).
    The body references one by index using SARIF's **embedded link** syntax
    (§3.11.6) — `[the caller](0)` — which renders as a jump-to-line link
    (§20.6). Written by `glassbox note add --related <file:line>` (repeatable);
    order is significant, since the link's destination integer is the index.
- **Future / intended SARIF fields (not currently emitted).** The following are
  reserved by this design for later phases — the reader tolerates them but
  `buildResult` does **not** write them today: column/offset region precision
  (`startColumn`/`endColumn`/`charOffset`/`charLength`); a symbol fallback in
  `logicalLocations[]` (`fullyQualifiedName`, `kind`); the persisted stale flag
  `result.baselineState` (`new`/`unchanged`/`updated`/`absent`) — staleness is
  presently recomputed at load time per §20.3 rather than stored; a proposed
  change in `result.fixes[]`; and narrative/sequence linking via
  `codeFlows`/`threadFlows`.
- **Note kind** — Each note carries a kind from a controlled vocabulary:
  `rationale`, `proof`, `assumption`, `alternative-considered`, `risk`,
  `test-evidence`, recorded in the standard `result.properties.tags` array.
  Notes use `result.kind: "informational"`.
- **Exactly one custom field.** Every datum maps to standard SARIF except
  `confidence` (0–1), which has no standard home and is stored under the
  namespaced property `result.properties["ext-ai-tool-confidence"]` (named so it
  reads as a producer extension, not a SARIF or Glassbox field). The
  `partialFingerprints` algorithm key is `"prNoteAnchor/v1"`. Within a shard,
  results are grouped into SARIF runs by (producer, baseline commit) so
  `versionControlProvenance` stays accurate per run.
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
- **Re-match through the existing stale machinery** *(shipped, P3)* — When
  Glassbox loads notes against the current tree, it re-anchors them using the
  same match-or-mark-stale logic it applies to human annotations
  (`reanchorReviewNotes`, mirroring `src/review-update.ts`): a matched note
  renders at its current line; an unmatchable note is flagged stale and rendered
  with an "outdated" badge plus **Keep** / **Discard** controls — Keep dismisses
  the flag for the session, Discard removes the note from `.pr-notes/` via
  `DELETE /api/review-notes/:guid` (the `removeNote` store op).

### 20.4 Authoring

Authoring shall support a combined live-plus-coalesce flow (not either/or):

- **Live, incremental authoring** — As the AI edits, it shall be able to emit
  notes in place at the moment of richest context, rather than reconstructing
  reasoning after the fact. **Authoring is producer-side, not a Glassbox live
  service** — Glassbox isn't running while the AI codes. Two adoptable paths:
  (1) the producer shells out to the **`glassbox note` CLI** (`glassbox note add
  --file … --lines A-B --kind … --body -`), the reference writer that owns the
  SARIF shape, fingerprint, baseline provenance, and shard layout; or (2) for
  tools that can't shell out, the producer writes the SARIF directly per this
  spec (see the inbound AI-instructions contract below). An earlier
  `glassbox_attach_review_note` MCP-tool idea was dropped for this reason.
- **Unknown flags are an error, never ignored** — Each subcommand accepts a
  fixed flag set and rejects anything else, listing what it does accept. A
  silently-dropped flag is the worst failure mode for a producer that shells
  out: it exits 0 and writes a note missing exactly what was asked for. This
  catches both an ordinary typo and — the case that motivated it — a flag added
  in a *newer* release being passed to an older installed binary, so the error
  also names the running version.
- **Revision and correction** — The AI shall be able to update or remove its own
  earlier notes as the work evolves, so notes reflect the final state of the
  change rather than an obsolete intermediate step.
- **Final coalescing pass** — On completion, a consolidation pass shall reduce
  unhelpful verbosity (merging or dropping redundant notes) and surface
  cross-cutting relationships that weren't visible while editing a single file
  (linking related notes across files). The **mechanical dedup** half ships as
  `glassbox note coalesce` (drops notes with an identical anchor + kind + body,
  keeping the most recent); the **AI-driven cross-cutting** half — merging
  near-duplicate notes that say the same thing in different words and linking
  related notes across files — is **producer-side, not a Glassbox primitive**.
  It's a judgment a model makes, so it ships as guidance in the inbound
  AI-instructions contract (below): a "Final consolidation pass" that the
  generating AI runs after `coalesce`, using the existing `update` / `remove`
  primitives to merge near-duplicates, and shared `--ticket` + inline "see also
  `path`" references in note bodies to link related notes. (A dedicated
  `glassbox note link` primitive recording SARIF `relatedLocations`, plus a
  "related" render in the diff, is deferred until a consolidation pass actually
  emits structured links — there is no point building the link UI before a
  driver produces links.)
- **Inbound AI-instructions contract** — Glassbox already ships *outbound* AI
  instructions in its markdown export ("here's how to act on annotations"). The
  symmetric *inbound* contract — telling a generating AI **when and how to emit**
  review notes — ships as a single canonical text
  (`src/review-notes/instructions.ts`) surfaced via **`glassbox note
  instructions`**. Any orchestrator (Hot Sheet, a Claude Code skill, any agent
  runner) runs the command and injects the output into the coding AI's context,
  so the wording never forks from the actual `glassbox note` CLI surface. See
  §20.7 for the cross-tool obligation to actually induce note production.
  The canonical text also carries the §20.5 artifact guidance (GB via Hot Sheet
  HS-9377): a "Proof artifacts" section instructing the generating AI to attach
  evidence with `--artifact` — and, **when a diagram is the clearest proof or
  rationale** (state machine, data/control flow, sequence, architecture), to
  write it as **Mermaid source** under `.pr-notes/artifacts/` rather than a
  rendered image or ASCII art.

### 20.5 Artifacts

- **Text artifacts committed as text** — Proof artifacts that are text shall be
  stored as text and committed: diagrams as *source* (Mermaid / Graphviz /
  PlantUML — never rendered images), plus test output, logs, perf numbers, and
  command transcripts. They are referenced from a note via
  `artifactLocation.uri` (relative path under `.pr-notes/`).
- **Binary artifacts via Git LFS** *(shipped)* — Genuinely binary artifacts
  (screenshots) are stored under `.pr-notes/artifacts/` and tracked with Git LFS:
  `glassbox note add --artifact` of an image idempotently ensures the
  `.gitattributes` filter (`.pr-notes/artifacts/** filter=lfs diff=lfs merge=lfs
  -text`), so history stays lean. Each is referenced by `artifactLocation.uri`
  and the writer records a sha-256 hash on the attachment
  (`artifactLocation.properties["ext-sha256"]`) for verification; binary bytes
  are never inlined (`artifact.contents`).
- **Minimize binaries** — Authors shall prefer text/diagram-source over images,
  downscale and compress screenshots (WebP/AVIF), and attach one artifact per
  *claim* rather than per step, to avoid bloating history even under LFS.

### 20.6 Viewing in Glassbox

- **Rendered like review comments** — Notes shall be presented primarily the way
  existing line-level review comments are, anchored in the diff at their line,
  not in a separate side pane. Bodies render as **markdown** via a safe,
  escape-first renderer (`src/utils/noteMarkdown.ts`, shared with the
  risk/narrative/guided AI notes).
- **Rendered markdown subset** — The renderer supports **blocks** — paragraphs,
  ATX headings, unordered/ordered lists (nested), fenced code blocks (``` and
  `~~~`), blockquotes, thematic breaks — and **inline** code spans, bold,
  italic, and http(s)/mailto links. This is the contract producers are told they
  can rely on (`glassbox note instructions`). Deliberately outside it: tables,
  indented (non-fenced) code blocks — indented text in a note is far more often
  a continuation than a code block — reference-style links, and raw HTML, which
  can never render (see the security bullet below). Two deviations from GFM are
  intentional: a single newline inside a paragraph stays a visible break rather
  than collapsing to a space, because note bodies are line-oriented prose whose
  authors mean the breaks they type; and headings render as `h4`–`h6` (relative
  depth preserved, clamped at `h6`) so an embedded note can never outrank the
  page's own heading chrome.
- **Embedded links jump to code** — A link whose destination is a non-negative
  integer is a SARIF **embedded link** (§3.11.6): the integer indexes the note's
  `relatedLocations` (§20.2), and it renders as a click-to-navigate link to that
  file and line, reusing the doc-13 navigation (the file if it's in the review,
  otherwise the read-only raw view, with the jump pushed onto the back/forward
  stack). It carries **no `href`** — the client's delegate navigates — so a
  stray click can never leave the app. **Fail-soft:** an index that is out of
  range, or names an entry missing a uri or line, stays literal text rather than
  becoming a dead link. The reader keeps an unusable `relatedLocations` entry as
  a placeholder rather than dropping it, so later indices still line up.
- **Safe by construction, not by sanitizer** — The body is HTML-escaped *first*,
  then the block and inline passes run over the escaped text and emit only a
  fixed tag allowlist; the sole dynamic attribute, a link `href`, is scheme-
  gated. So no markup in a note body can reach the DOM, and the output is safe
  to pass to `raw()`. This is what SARIF §3.11.4 requires of a consumer that
  renders formatted messages ("disable HTML processing … or run the resulting
  HTML through an HTML sanitizer") — met by construction, which is why a full
  markdown library plus a sanitizer is deliberately **not** used. Recursion
  (nested lists, blockquotes) is depth-capped for the same section's warning
  about deeply nested markup overflowing a processor's stack.
- **Visually distinct as AI-authored** — Notes shall be styled distinctly so it
  is immediately apparent they are AI-authored review companions rather than the
  reviewer's own annotations — following the precedent of the guided-review
  presentation. An annotation source flag (`ai` vs `human`) shall drive this.
- **Kind-aware surfacing** — Note kinds shall map onto existing surfaces where
  natural: `risk` / `assumption` can seed the risk dimensions; an author-stated
  reading order can seed narrative ordering; `rationale` reads like
  guided-review educational text.
- **Artifact rendering** *(text + image shipped)* — A note attaches artifacts via
  `glassbox note add --artifact <path>` (SARIF `result.attachments`). Text and
  diagram-*source* artifacts render as an inline, collapsible code block; **image
  artifacts** (`.png`/`.webp`/`.avif`/`.gif`/`.jpg`/`.svg`) render as an `<img>`
  served by `GET /api/review-notes/artifact` (path-contained, content-typed,
  size-capped). The reviewer can **mark a rectangle on an image artifact** two
  ways: **inline** — drag directly on the thumbnail (a plain click instead opens
  the full-screen lightbox, which can be **zoomed/panned** to mark a precise spot
  on a large artifact — doc 25 FR-25.7 / GB-963) — or in the **lightbox** itself.
  Either way the
  rectangle is carried into the reply they then write, and a reply can carry
  **several** marks (GB-959): the reply renders each artifact with its
  rectangle(s) over it (a "see this spot" thumbnail). Each region reuses doc 23's
  normalized `{x,y,w,h}` model (plus an `artifact` uri); a multi-mark reply
  stores a JSON **array** of them in the reply annotation's `region_data` (a
  single object is still read for back-compat). The lightbox lives in
  `src/client/lightbox.tsx`, inline marking in
  `src/client/diff/noteArtifactRegions.tsx`, the array decode/group helpers in
  `src/utils/artifactRegions.ts`, and the marked thumbnail in
  `src/components/reviewNoteRegionThumb.tsx` (doc 25 / GB-953, GB-959). The reader is
  path-contained + size-capped throughout. **Live
  diagram rendering** of diagram-source artifacts *(shipped via doc 29)*: the
  reader offers each text artifact to the content-plugin dispatcher
  (`src/plugins/artifacts.ts` `renderNoteArtifacts`), and a matching renderer
  (Mermaid/Graphviz/PlantUML) attaches inert SVG the diff view shows inline as
  an actual diagram — falling soft to the source code block when no plugin is
  installed.
- **Threading** *(shipped)* — A reviewer can reply to an AI note with their own
  annotation, turning a note into a line-anchored conversation. The note row
  carries its SARIF `guid` (`data-note-id`) and a **Reply** button; the reply is
  a normal human annotation linked by a nullable `reply_to_note_id` column on
  `annotations`, rendered with a "↳ reply" tag and **nested directly beneath the
  note** it answers (an orphan reply — whose note isn't loaded — falls back to
  line rendering).
- **Origin-commit provenance** *(shipped, GB-1142)* — Each note records the commit
  it was authored against (SARIF `versionControlProvenance.revisionId`, written
  from `HEAD` at authoring time, per-run so a shard accumulating notes from
  several commits keeps each note's own commit). This is exposed on
  `ReviewNoteView.origin` (`{ sha, shortSha, subject?, message? }`): the store
  reads the sha, and `resolveNoteOrigins` (`src/review-notes/origin.ts`) fills the
  subject + full message from git at render time (`getCommitInfo` in
  `src/git/repo.ts`, cached per sha; unresolvable shas degrade to the short hash).
  A **clickable provenance label** renders at the bottom of every note that has a
  commit — `‹shortSha› ‹subject›` — and **expands to the full commit message** on
  click (`NoteCommitLabel` in `diffView.tsx`; toggle delegated in
  `client/diff/index.tsx`). It shows in both the inline and the context-reveal
  (doc 32) note paths. *(A "open that commit as a review, jumping to the note's
  line" button is deferred — it needs cross-review review-creation + a file+line
  deep-link that don't exist yet — tracked separately.)*
- **Sidebar surfacing** *(shipped)* — Because notes live in committed files, the
  sidebar makes them findable:
  - **Note icon on files with notes in this review** *(GB-1136)* — A file whose
    review notes belong to **this review** is marked in the file list with a
    message icon (`IconMessageSquareText`), across every sort mode (folder / risk
    / narrative). Scoped to the review's own note changes — **not** every file
    that has notes on disk: a note shard is itself among the review's files, so
    `notedSourcesInFiles` maps the shard paths back to their sources
    (`noteSourceForShardPath`). The result is delivered to the client as
    `notedFileIds` on `GET /api/files` (and passed to the initial server paint
    via `ReviewShell`). So a changed file that has an older, unrelated note gets
    **no** icon — though opening it still renders that older note (below). Demo
    mode has no on-disk notes, so it marks the files its synthetic
    `demoReviewNotes` covers instead.
  - **Note-bearing-but-unchanged files still appear** *(GB-1137)* — When a
    review's **own change set** adds or changes a note about a file whose source
    wasn't itself changed, that file is still shown, labeled `unchanged`, so the
    note stays reachable. The scope is deliberately the review's diff, **not**
    every file that has ever had a note on disk: an AI writes a note in the same
    changeset as the work, so the note shard
    (`.pr-notes/notes/<src>.NNNNNN.sarif`) appears in the diff exactly when its
    note belongs to this review. `collectNoteOnlyFiles` (`src/review-notes/
    unchanged-files.ts`, called from `src/cli.ts`) maps each note shard in the
    diff back to its source (`noteSourceForShardPath`) and, if that source
    wasn't changed, adds it with a synthetic `unchanged` `FileDiff` whose single
    hunk renders the whole current file as context lines, so the notes anchor
    inline. Git review modes only (`--diff` / `--ground-truth` have no repo notes
    tree); deleted note shards, sources already in the diff, the `.pr-notes/`
    store itself, and notes for since-deleted or unreadable files are skipped.
    `unchanged` was added to the `FileDiff` status enum for this.
  - **`.pr-notes` folders collapsed by default** *(GB-1135)* — The committed
    SARIF files under `.pr-notes/` show as ordinary files, but their folder is
    **collapsed by default** so they don't clutter the tree. On a review's first
    visit the client seeds the collapsed-folder set with the `.pr-notes` tree's
    top folder key (`noteStorageFolderKeys`) and persists it, so a later manual
    expand still sticks (it isn't re-seeded on the next load).

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
- **AI-summarizable** *(shipped, P5)* — Glassbox's AI analysis ingests the notes
  to pre-seed risk/narrative analysis from the author's own stated risks and
  assumptions (an "Author review notes" prompt section, `runAnalysisBatch`), and
  folds note content into the `.glassbox/latest-review.md` export (an "AI Review
  Notes" section). The notes thus serve as both an input to review and a
  byproduct the next AI session can read.
- **Multi-line bodies fold without corrupting either surface** — A body is
  markdown and may span lines. A single-line body stays inline after its list
  label (the common case); a multi-line body moves to its own block, indented to
  the list item's content column, so a continuation line can never land at
  column 0 and terminate the list. In the export the body's headings are also
  demoted so the shallowest sits one level below the per-file `### <file>`
  heading — preserving their relative structure while keeping the document
  outline a reader (or the next AI session) sees intact. Headings inside fenced
  code are left alone. The analysis prompt indents identically but does not
  demote, since it delimits sections with `=== … ===` rather than headings.

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

- **P1** *(shipped)* — The `.pr-notes/` SARIF profile (`src/review-notes/`) and a
  producer-side writer, the `glassbox note` CLI: `add`, `update` / `remove` (by
  note guid, scoped by `--file` or a global search), and a mechanical `coalesce`
  that drops redundant notes (identical anchor + kind + body, keeping the most
  recent). The AI-driven cross-cutting *linking* aspect of coalescing (§20.4)
  ships as producer-side guidance in the inbound instructions contract (the
  "Final consolidation pass"), not as a Glassbox primitive. (The
  originally-planned channel MCP tool was replaced by the CLI — see §20.4.)
- **P2** *(shipped)* — Ingest and render notes as a distinct, review-comment-
  style source in the diff. A reader (`loadReviewNotesForFile`,
  `src/review-notes/store.ts`) flattens `.pr-notes/` SARIF into diff-anchored
  view items (`src/review-notes/view.ts`); the `/file/:id` route passes them to
  `DiffView`, which renders them **server-side, full-width below their line**
  (breaking the split-column flow like human annotations do, so columns stay
  aligned), styled distinctly as AI-authored (the `ai-note-*` precedent) with a
  per-kind badge. Demo mode serves illustrative notes. (Both of P2's own
  follow-ups have since shipped: note bodies render as **markdown** via the
  escape-first `src/utils/noteMarkdown.ts`, and **threading** is in — see
  §20.6.)
- **P3** *(shipped)* — Anchor durability: `reanchorReviewNotes`
  (`src/review-notes/reanchor.ts`) re-matches each note's authored text against
  the current diff at load time (the same content-near-the-line approach the
  human-annotation stale matcher uses) — a note whose line shifted is moved, one
  whose text is gone is flagged `stale` and rendered with an "outdated" badge.
  The note's authored snippet is carried on the view. A reviewer can **Keep** a
  stale note (dismiss the flag) or **Discard** it (`DELETE
  /api/review-notes/:guid` → `removeNote`, deleting it from `.pr-notes/`).
- **P4** *(shipped)* — Artifact attachment (`--artifact` → SARIF
  `result.attachments`), inline code-block rendering of text/diagram-source
  artifacts, `<img>` rendering of image artifacts via a path-contained serving
  route, sha-256 hashes, and Git LFS `.gitattributes` wiring. Live *diagram*
  rendering shipped via the content-plugin system (doc 29): with a matching
  renderer installed (Mermaid/Graphviz/PlantUML), a diagram-source artifact
  renders inline as an actual diagram, falling soft to the source code block
  otherwise.
- **P5** *(shipped)* — Feed notes into analysis and the export
  (`src/review-notes/format.ts`). `runAnalysisBatch` (shared by risk / narrative
  / guided) appends an "Author review notes" section to the prompt, so all three
  analyses are informed by the author's stated risks / assumptions / rationale;
  `generateReviewExport` folds an "AI Review Notes" section into
  `.glassbox/latest-review.md` for the next session. (Author-stated *risks /
  assumptions* seed analysis directly; an explicit author-stated *reading order*
  signal beyond letting the notes inform narrative analysis is a possible future
  enhancement.)
- **Cross-cutting** — The inbound AI-instructions contract (§20.4) *(shipped —
  `glassbox note instructions` prints the canonical text)*; the Hot Sheet-side
  obligation to actually induce note production (§20.7) lives outside Glassbox
  and runs that command to get the wording. The contract now also instructs the
  **AI-driven cross-cutting consolidation pass** (§20.4) — merge near-duplicates
  and link related notes via the existing `update` / `remove` primitives — so
  the AI-driven half of coalescing is producer-side, with no Glassbox link
  primitive built until a driver emits structured links.

## Maintenance triggers

Update this document when: the storage location or directory name changes; the
SARIF profile (fields used, note-kind vocabulary, property keys) changes; the
authoring tool surface changes; the rendering model changes; or the artifact
storage policy changes. When any phase ships, update its status here and in
`docs/ai/requirements-summary.md`.
