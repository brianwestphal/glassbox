/**
 * Membership check for an `as const` enum tuple. Narrows the value to the
 * tuple's union when valid, or returns a 400-ready error message.
 */
export function checkEnum<T extends readonly string[]>(
  value: unknown,
  name: string,
  allowed: T,
): { ok: T[number] } | { error: string } {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return { error: `${name} must be one of: ${allowed.join(', ')}` };
  }
  return { ok: value };
}

/**
 * Type guard for a non-empty trimmed string. Rejects non-strings,
 * empty strings, and whitespace-only strings — the same pattern that
 * appeared inline at every API validation site.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
