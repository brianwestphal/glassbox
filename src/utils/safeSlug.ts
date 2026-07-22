/**
 * A filesystem-safe id: alphanumeric first character, then alphanumerics,
 * dot, underscore, or hyphen — max 128 chars. No path separators and no
 * leading dot, so a matching value can never traverse out of the directory it
 * is joined to (`..`, `../x`, `.hidden`, and encoded `..%2F` all fail).
 * Shared by the plugin-manifest schema and the slug-taking routes (doc 14).
 */
export const SAFE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
