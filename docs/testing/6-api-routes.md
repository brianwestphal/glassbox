# 6. API Routes

Test coverage for `src/routes/api.ts` and `src/routes/ai-api.ts` — HTTP endpoint behavior, request validation, and response contracts.

API tests should use Hono's built-in test client (or `app.request()`) with a real in-memory PGLite database. No actual HTTP server needed.

## Review Management Endpoints

### `GET /api/review`
- **Current review** — Returns the active review with all metadata (mode, status, timestamps, HEAD SHA).
- **No active review** — Returns 404 when no review exists for the session.

### `POST /api/review/complete`
- **Successful completion** — Marks the review as completed. Verify status changes to `completed`, `completed_at` is set, and the export file is generated.
- **Already completed** — Attempting to complete an already-completed review. Verify appropriate response (idempotent or error).

### `POST /api/review/reopen`
- **Successful reopen** — Reopens a completed review. Verify status returns to `in_progress` and `completed_at` is cleared.

### `GET /api/reviews`
- **Multiple reviews** — Returns all reviews for the current repo, ordered by creation time.
- **Empty history** — No past reviews. Returns empty array.

### `DELETE /api/review/:id`
- **Delete past review** — Removes a completed review and its export file.
- **Delete current review** — Attempting to delete the active review. Verify it is rejected.
- **Non-existent review** — Returns 404.

### `POST /api/reviews/delete-completed`
- **Bulk delete** — Deletes all completed reviews. Verify in-progress reviews are preserved.

### `POST /api/reviews/delete-all`
- **Bulk delete all** — Deletes all reviews except the current one.

## File Endpoints

### `GET /api/files`
- **File listing** — Returns files with paths, statuses, annotation counts, and stale counts.
- **Annotation count accuracy** — After adding annotations, verify counts reflect the current state.

### `GET /api/files/:fileId`
- **File with annotations** — Returns file details and all its annotations.
- **Non-existent file** — Returns 404.

### `PATCH /api/files/:fileId/status`
- **Mark reviewed** — Sets file status to `reviewed`. Verify persistence.
- **Mark pending** — Sets file status back to `pending`.
- **Invalid status** — Rejects statuses other than `reviewed` or `pending`.

## Annotation Endpoints

### `POST /api/annotations`
- **Create annotation** — Provide fileId, line, side, category, content. Verify all fields are saved and the response includes the generated ID.
- **Missing required fields** — Omit fileId or line. Verify 400 response.
- **Invalid category** — Provide an unknown category. Verify rejection.

### `PATCH /api/annotations/:id`
- **Update content** — Change annotation text. Verify persistence.
- **Update category** — Change category. Verify persistence.
- **Partial update** — Update only content, only category, or both.
- **Non-existent annotation** — Returns 404.

### `DELETE /api/annotations/:id`
- **Delete annotation** — Remove an annotation. Verify it no longer appears in file listings.

### `PATCH /api/annotations/:id/move`
- **Move to new line** — Change line number and/or side. Verify new position is saved.

### `POST /api/annotations/:id/keep`
- **Keep stale** — Clear the stale flag on a stale annotation.

### `POST /api/annotations/stale/delete-all`
- **Batch delete stale** — Remove all stale annotations for the review.

### `POST /api/annotations/stale/keep-all`
- **Batch keep stale** — Clear stale flags on all stale annotations.

### `GET /api/annotations/all`
- **All annotations** — Returns every annotation for the current review, joined with file paths.

## Context and Outline Endpoints

### `GET /api/context/:fileId`
- **Fetch lines** — Returns lines from the working directory file for context expansion. Verify correct line range.
- **Non-existent file** — File has been deleted from disk. Verify graceful error.

### `GET /api/outline/:fileId`
- **Symbol list** — Returns parsed functions/classes for the file. Verify structure includes name, kind, start line, end line.
- **Unsupported language** — File with no parser support. Returns empty list.

## Settings Endpoints

**Status: Implemented** in `tests/integration/api/routes.test.ts`.

### `GET /api/project-settings`
- ✅ **Read settings** — Returns the contents of `.glassbox/settings.json`.
- ✅ **No settings file** — Returns empty/default settings.

### `PATCH /api/project-settings`
- ✅ **Save app name** — Write `appName` to settings. Verify persistence.
- ✅ **Clear app name** — Set empty string. Verify it is removed or set to empty.

> Note: the `/api/gitignore/*` routes were removed — `.gitignore` is now managed
> automatically at launch (doc 27), unit-tested via `computeGitignore`.

## AI Configuration Endpoints

### `GET /api/ai/config`
- **Current config** — Returns platform, model, key status, and guided review settings.

### `POST /api/ai/config`
- **Save config** — Update platform, model, and guided review settings. Verify persistence.

### `GET /api/ai/models`
- **Model listing** — Returns all available platforms and their models.

### `GET /api/ai/key-status`
- **Key status** — Returns configured/not-configured status for each platform, plus keychain availability.

### `POST /api/ai/key`
- **Save key** — Store an API key with the specified storage method (keychain or config).

### `DELETE /api/ai/key`
- **Remove key** — Delete the key for the specified platform.

### `POST /api/ai/analyze`
- **Trigger analysis** — Start a risk, narrative, or guided analysis. Verify the analysis record is created.
- **Invalid type** — Reject unknown analysis types.
- **No key configured** — Verify appropriate error when no API key is available.

### `GET /api/ai/preferences` / `POST /api/ai/preferences`
- **Read/write preferences** — Round-trip sort mode, risk dimension, and score visibility settings.

## Response Contract Tests

- **JSON content type** — All API responses have `Content-Type: application/json`.
- **404 on missing resources** — All GET-by-ID endpoints return 404 for non-existent IDs.
- **400 on bad input** — Endpoints reject malformed request bodies with 400 status and descriptive messages.
- **Consistent ID format** — All returned IDs match the expected format (base36 timestamp + random suffix).

## Edge Cases

- **Concurrent requests** — Multiple annotation creates on the same file simultaneously. Verify no data loss.
- **Very large request body** — Annotation with extremely long content. Verify it is handled (saved or rejected with a size limit).
- **Empty request body** — POST/PATCH with no body. Verify 400 response, not a crash.
- **SQL injection attempts** — Malicious strings in annotation content. Verify parameterized queries prevent injection.
