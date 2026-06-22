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
- **FR-25.2 — Two ways to attach.** Each feedback item shall offer (a) an
  **attach button** that opens the OS file picker, and (b) **drag-and-drop** of
  one or more files onto the feedback item.
- **FR-25.3 — Chips.** Attached files render as chips beneath the comment,
  each showing the file name. Chips persist with the review (reloading the diff
  re-hydrates them from the server).

## 25.2 Preview (Quick Look)

- **FR-25.4 — OS preview.** Selecting an attachment chip and pressing **Space**
  (or clicking it) shall open the file in the OS preview: macOS **Quick Look**
  (`qlmanage -p`), and the platform default opener on Windows (`start`) and
  Linux (`xdg-open`). Because the Glassbox Node server is always local (CLI or
  Tauri sidecar), the preview is launched by the server shelling out — the same
  mechanism "reveal in file manager" uses (doc 21) — so it works in both the
  desktop app and a plain browser pointed at the local server.

## 25.3 AI consumption

- **FR-25.5 — Readable by the AI tool.** The completion export
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

- **Shipped (P1):** the data + API layer for *any* annotation (upload / list /
  serve / quicklook / delete), the chip UI + attach button + drag-drop on
  **line annotations**, OS Quick Look, and the export integration.
- **Follow-ups:** the same attachment bar on the **image-feedback** comments /
  regions UI (doc 23) and on **note replies** (doc 20); paste-to-attach from the
  clipboard; inline image thumbnails on chips. (The backend already accepts
  attachments on those annotations — only the UI wiring is pending.)

## Implementation pointers

- DB: `attachments` table in `src/db/schema.ts`; row schema `AttachmentSchema` in
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
