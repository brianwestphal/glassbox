/**
 * Membership check for an `as const` enum tuple. Narrows the value to the
 * tuple's union when valid, or returns a 400-ready error message.
 */
export function checkEnum<T extends readonly string[]>(
  value: unknown,
  name: string,
  allowed: T,
): { ok: T[number] } | { error: string } {
  if (typeof value !== 'string' || !allowed.includes(value as T[number])) {
    return { error: `${name} must be one of: ${allowed.join(', ')}` };
  }
  return { ok: value as T[number] };
}
