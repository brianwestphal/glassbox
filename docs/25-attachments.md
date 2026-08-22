# 25. Feedback Attachments

Reviewers can attach arbitrary files to a feedback item — a screenshot of the
bug, a log, a spec, a short screen recording — so the comment carries the
evidence with it. Attachments are stored locally alongside the review and are
surfaced to the AI tool that acts on the review (Claude Code, etc.) by absolute
path, so it can read them.

This builds on the annotation model: any annotation — a line comment, a general
image comment, an image-region comment (doc 23), or a note reply (doc 20) — can
carry attachments. The data + API layer is annotation-generic; see "Status"
for which UI surfaces are wired today.

## 25.1 Attaching

- **FR-25.1 — Any file type.** A reviewer shall be able to attach a file of any
  type to a feedback item. Files up to 50 MB are accepted.
- **FR-25.2 — Ways to attach.** Each feedback item shall offer (a) an **attach
  button** that opens the OS file picker, (b) **drag-and-drop** of one or more
  files onto the feedback item, and (c) **clipboard paste** — pasting a file
  while a feedback item is focused (a focused attachment chip, or an open edit
  form) attaches it to that annotation. A plain-text paste is left to the
  browser; the not-yet-saved create form has no annotation to attach to.
- **FR-25.3 — Chips.** Attached files render as chips beneath the comment,
  each showing the file name. Chips persist with the review (reloading the diff
  re-hydrates them from the server).

## 25.2 Preview

- **FR-25.4 — In-app preview for images/PDFs.** An image (`image/*`) or PDF chip,
  when clicked or activated with **Space**, shall open in a full-screen in-app
  overlay (lightbox) — instant, stays in the app, and works in any browser.
  Esc, Space, or a backdrop click dismisses it.
- **FR-25.7 — Zoom/pan in the lightbox (shipped, GB-963).** An image in the
  lightbox can be **zoomed** (wheel / pinch / the on-screen +/− controls, up to
  8×) and **panned** (drag a zoomed image, or two-finger / wheel), so a reviewer
  can inspect — and, on a markable artifact, precisely mark — a region on a large
  image. The zoom/pan math is pure + unit-tested (`src/client/lightboxZoom.ts`);
  region fractions stay correct under any transform because they're read from the
  overlay's live post-transform bounding rect. PDFs are not zoomed (native
  iframe). The lightbox (`src/client/lightbox.tsx`) is shared by attachment
  previews, AI-note image artifacts (doc 20 §20.5), and **image-file diffs**
  (doc 24 — GB-966): a hover "view full screen" button on each image canvas (each
  side-by-side pane, and the single-image added/deleted viewer) opens that side
  in the same lightbox, supplementary to the in-place pan/zoom/slice.
- **FR-25.5 — OS opener for other types.** A non-previewable attachment shall
  open in the OS default application: macOS **Quick Look** (`qlmanage -p`), the
  platform default opener on Windows (`start`) and Linux (`xdg-open`). Because
  the Glassbox Node server is always local (CLI or Tauri sidecar), it's launched
  by the server shelling out — the same mechanism "reveal in file manager" uses
  (doc 21) — so it works in both the desktop app and a plain browser.
- **FR-25.6 — Image thumbnails.** Image attachments shall show a small inline
  thumbnail on their chip (served from `GET /api/attachments/:id/raw`) instead of
  the generic file icon.

## 25.3 AI consumption

- **FR-25.8 — Readable by the AI tool.** The completion export
  (`.glassbox/latest-review.md`, doc 6) shall list each feedback item's
  attachments with their **absolute on-disk paths** under the comment, plus an
  instruction telling the AI tool the paths are real files it can read. This is
  how Claude (or any tool consuming the export) gets at the bytes.

## 25.4 Storage & lifecycle

- **NFR-25.1 — Local storage.** Bytes live on disk under
  `<dataDir>/attachments/`, named `<id>-<sanitized original name>` (the original
  name — and its extension, which drives the OS preview handler — is preserved).
  The `attachments` table (doc 9) holds the metadata: `annotation_id`,
  `original_filename`, `stored_path`, `mime_type`, `size`, `sha256`.
- **NFR-25.2 — Cascade cleanup.** Deleting an annotation removes its attachment
  rows (DB `ON DELETE CASCADE`) and their files on disk; deleting a single
  attachment removes both its row and its file.
- **NFR-25.3 — Path containment.** Uploaded filenames are sanitized (path
  separators and control/reserved characters stripped) so a crafted name can't
  escape the attachments directory.

## Status

- **Shipped:** the data + API layer for *any* annotation (upload / list / serve /
  quicklook / delete); the chip UI + attach button + drag-drop + paste-to-attach
  on **line annotations**, **note replies** (they reuse the same `AnnotationItem`),
  and **image-feedback** comments / regions (doc 23); image thumbnails + the
  in-app preview overlay; the OS opener for other types; and the export
  integration.

## Implementation pointers

- DB: `attachments` table (DDL in `src/db/ddl.ts`); row schema `AttachmentSchema` in
  `src/db/schemas.ts`; queries in `src/db/attachment-queries.ts`. Annotation
  delete cleans up files (`deleteAnnotation` in `src/db/queries.ts`).
- Storage: `src/attachments/store.ts` (`writeAttachmentFile` / `sanitizeFilename`
  / `deleteAttachmentFile`); MIME fallback `src/utils/mime.ts`.
- API: `src/api/attachments.ts` (schemas + typed callers, incl. the multipart
  `uploadAttachment`); routes `src/routes/api/attachments.ts`
  (`POST/GET /annotations/:id/attachments`, `GET /attachments/all`,
  `GET /attachments/:id/raw`, `POST /attachments/:id/quicklook`,
  `DELETE /attachments/:id`).
- Quick Look: the `'quicklook'` mode of `src/utils/openOS.ts`.
- Client: chips / upload / drag-drop / preview in
  `src/client/annotations/attachments.tsx`; mounted on annotation rows in
  `src/components/diffView.tsx` + `src/client/annotations/render.tsx`
  (an `[data-att-list]` container + an attach button); hydrated from
  `runPostRender` in `src/client/diff/index.tsx`.
- Export: `src/export/generate.ts` lists attachment paths under each annotation.

## Tests

- Unit: `tests/unit/utils/mime.test.ts`, `tests/unit/attachments/store.test.ts`.
- Integration: `tests/integration/api/attachment-routes.test.ts` (upload → list →
  serve → quicklook → delete).
- E2E: `tests/e2e/attachments.test.ts` (attach via the button, chip renders,
  persists across reload, and removes).
