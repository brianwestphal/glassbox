/**
 * Git LFS pointer detection.
 *
 * An LFS-tracked file is stored in the repository as a small **text pointer**:
 *
 * ```
 * version https://git-lfs.github.com/spec/v1
 * oid sha256:0123…  (64 hex chars)
 * size 232246
 * ```
 *
 * The real bytes live outside the object database. That is invisible in a
 * working tree with LFS installed, but very visible to anything reading git
 * directly: `git diff` reports a three-line *text* diff instead of "Binary
 * files … differ", and `git show <ref>:<path>` hands back the pointer rather
 * than the file. Glassbox therefore has to recognize a pointer to keep treating
 * an LFS-tracked image as an image (docs/3 — image diffs).
 *
 * This matters for Glassbox's own output, not just user repos: review-note
 * screenshot artifacts are deliberately routed through LFS (doc 20 §20.5).
 */

/** Pointer files are tiny; the spec caps them well under this. Bounding the
 *  check keeps it from scanning a large binary that coincidentally starts with
 *  ASCII. */
const MAX_POINTER_BYTES = 1024;

const VERSION_LINE = 'version https://git-lfs.github.com/spec/v1';
const OID_RE = /(^|\n)oid sha256:[0-9a-f]{64}(\r?\n|$)/;
const SIZE_RE = /(^|\n)size \d+(\r?\n|$)/;

/**
 * Whether `data` is a Git LFS pointer rather than real file content. Accepts a
 * Buffer (a blob read from git) or a string (content reconstructed from a diff).
 */
export function isLfsPointer(data: Buffer | string): boolean {
  const length = typeof data === 'string' ? data.length : data.byteLength;
  if (length === 0 || length > MAX_POINTER_BYTES) return false;

  // Check the version line before decoding: real binary content that happens to
  // be pointer-sized should cost one comparison, not a full UTF-8 decode.
  const head = typeof data === 'string'
    ? data.slice(0, VERSION_LINE.length)
    : data.subarray(0, VERSION_LINE.length).toString('latin1');
  if (head !== VERSION_LINE) return false;

  const text = typeof data === 'string' ? data : data.toString('utf-8');
  return OID_RE.test(text) && SIZE_RE.test(text);
}
