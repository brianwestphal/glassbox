# 5. AI Analysis

Test coverage for `src/ai/` — batch processing, API clients, configuration/key management, and the risk/narrative/guided analysis pipelines.

All AI tests should use mocked HTTP responses. No real API calls in automated tests.

## Unit Tests

### Batch Planning (`batch-planner.ts`)

- **Single batch** — A small review that fits within one batch's token budget. Verify all files are grouped into one batch.
- **Multiple batches** — A review exceeding the token budget. Verify files are split across batches with each batch under the budget.
- **Large single file** — A file that alone exceeds the batch budget. Verify it gets its own batch (not skipped).
- **Token estimation** — Verify the character-to-token heuristic (approx 3 chars per token) produces reasonable estimates for typical diffs.
- **Empty file list** — No files to analyze. Verify empty batch list, no errors.
- **Binary files excluded** — Binary files should be excluded from batches and assigned a score of 0.
- **Hunk summarization** — When a file's diff is very large, verify it is summarized to fit within the context budget rather than sent in full.

### Batch Runner (`batch-runner.ts`)

- **Successful run** — All batches complete. Verify final status is `completed` and all file scores are saved.
- **Partial failure with retry** — One batch gets a 429 rate limit error, then succeeds on retry. Verify retry occurs with backoff and final result includes all files.
- **Permanent failure** — A batch fails with a 400 error (no retry). Verify the analysis is marked `failed` with an error message.
- **Progress tracking** — During a multi-batch run, verify progress updates are recorded (completed_batches / total_batches) at each step.
- **Cancellation** — Cancel an analysis mid-run. Verify no further batches are executed and the analysis is marked canceled.
- **Concurrency limit** — Verify batches respect the concurrency limit (not all running simultaneously).

### AI API Client (`client.ts`)

Each platform has its own request format and response parsing.

- **Anthropic request** — Verify the request to `/v1/messages` includes correct headers (`x-api-key`, `anthropic-version`), the messages array, and max_tokens.
- **Anthropic response** — Parse a successful response. Verify content extraction and token count reading.
- **OpenAI request** — Verify the request to `/v1/chat/completions` includes the `Authorization: Bearer` header, model field, and messages.
- **OpenAI response** — Parse a successful response. Verify content extraction from `choices[0].message.content`.
- **Google request** — Verify the request to the Gemini API includes the API key as a query parameter and the correct body format.
- **Google response** — Parse a successful response. Verify content extraction from `candidates[0].content.parts[0].text`.
- **Error responses** — 401 (bad key), 429 (rate limit), 500 (server error) from each platform. Verify appropriate error messages.
- **Malformed response** — Response with unexpected JSON structure. Verify graceful handling (error, not crash).
- **Network error** — Connection refused or timeout. Verify the error is caught and reported.

### API Key Resolution (`config.ts`)

- **Environment variable** — Key set via `ANTHROPIC_API_KEY` (or platform-equivalent env var). Verify it is found and source is reported as `env`.
- **Config file** — Key stored in `~/.glassbox/config.json` with base64 encoding. Verify it is decoded correctly and source is reported as `config`.
- **Priority order** — Both env and config keys exist. Verify env takes precedence.
- **No key configured** — No key anywhere. Verify a clear "not configured" result.
- **Key save to config** — Save a key via the config file path. Verify it is base64-encoded and the file has `0600` permissions.
- **Key removal** — Remove a key from config. Verify it is deleted from the file.
- **Config file creation** — Save a key when `config.json` doesn't exist yet. Verify the file is created with correct permissions.

### Keychain Integration (`config.ts`)

Keychain tests should mock the shell commands (`security`, `secret-tool`, PowerShell) since they depend on the OS.

- **macOS keychain read** — Mock `security find-generic-password` output. Verify key extraction.
- **macOS keychain write** — Verify `security add-generic-password` is called with correct service and account.
- **macOS keychain delete** — Verify `security delete-generic-password` is called.
- **Linux secret-tool read** — Mock `secret-tool lookup` output. Verify key extraction.
- **Keychain not available** — When keychain commands fail (e.g., not installed). Verify fallback to config file storage.
- **Keychain source reporting** — When key comes from keychain, verify source is reported as `keychain`.

### Risk Analysis (`analyze-risk.ts`)

- **Score parsing** — A well-formed AI response with six dimension scores. Verify all scores are extracted as numbers between 0.0 and 1.0.
- **Aggregate scoring** — Verify the aggregate score is the maximum across dimensions (not average).
- **Rationale extraction** — Verify the per-file rationale string is extracted from the response.
- **Line-level notes** — Verify line notes with line numbers and concerns are parsed from the response.
- **Multi-turn context** — The AI requests full content for a file (`requestFullContext`). Verify the system provides it and re-submits.
- **Incomplete JSON** — The AI returns truncated JSON. Verify partial results are recovered where possible.
- **Score normalization** — Scores outside 0-1 range in the response. Verify they are clamped or rejected.

### Narrative Analysis (`analyze-narrative.ts`)

- **Ordering output** — Verify files are assigned sequential position numbers based on the AI's recommended reading order.
- **Rationale per file** — Verify each file has a rationale explaining its position.
- **Walkthrough notes** — Verify files have notes explaining changes and connections to other files.
- **Merge with previous** — When re-running analysis with some files unchanged, verify previous scores are carried forward for unchanged files.

### Guided Analysis (`analyze-guided.ts`)

- **Topic-specific notes** — Given a set of topics (e.g., "python", "programming"), verify the analysis produces relevant educational annotations.
- **Line-level placement** — Verify guided notes reference specific line numbers in the diff.
- **Independence from risk/narrative** — Guided analysis should run and cache independently of the other analysis types.

## Integration Tests

### Full Analysis Flow

- **Risk analysis end-to-end** — Create a review, trigger risk analysis with mocked AI responses, verify scores are saved to the database and retrievable via the API.
- **Narrative analysis end-to-end** — Same flow for narrative ordering.
- **Analysis caching** — Run analysis, verify results are cached. Request again, verify no new AI calls are made.
- **Cache invalidation** — Invalidate cache, re-run analysis. Verify fresh AI calls are made.
- **Analysis cancellation** — Start a risk analysis, switch to narrative mode. Verify the risk analysis is canceled and narrative proceeds.
- **Settings change invalidation** — Change guided review settings, verify risk/narrative caches are invalidated.

### Error Recovery

- **All batches fail** — Every batch returns an error. Verify the analysis is marked failed with a useful error message.
- **Mid-run cancellation** — Cancel after some batches complete. Verify partial results are not persisted as a complete analysis.
- **Database error during save** — Simulate a database error when saving scores. Verify the analysis is marked failed.

## Edge Cases

- **Zero-file analysis** — Trigger analysis with no files (all binary). Verify it completes with zero scores.
- **Single-file analysis** — Only one file in the review. Verify narrative ordering produces a single entry.
- **Very large diffs** — Files with thousands of lines of changes. Verify context summarization kicks in and stays within token budgets.
- **AI returns non-JSON** — The model outputs natural language instead of JSON. Verify the error is handled and reported.
- **Rapid re-triggers** — Trigger analysis twice in quick succession. Verify the first is canceled cleanly before the second starts.
