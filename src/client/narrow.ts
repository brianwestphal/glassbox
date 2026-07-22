/**
 * Zod-backed narrowing for UI-held strings entering typed API calls (GB-1087).
 * Client state and DOM data-attributes carry enum values as plain strings; the
 * convention (CLAUDE.md, "validating, not asserting") is to re-validate at the
 * point the string leaves the UI instead of `as`-casting — a mismatched value
 * falls back to a safe default rather than riding an assertion into the wire
 * call. `sidebar/index.tsx`'s `RiskDimensionSchema.safeParse` is the model.
 */
import type { AIPlatform, AnnotationCategory, KeyStorage } from '../api/index.js';
import { AIPlatformSchema, AnnotationCategorySchema, KeyStorageSchema } from '../api/index.js';

/** Narrow a UI string to an AI platform; falls back to `anthropic`. */
export function asPlatform(value: string): AIPlatform {
  const parsed = AIPlatformSchema.safeParse(value);
  return parsed.success ? parsed.data : 'anthropic';
}

/** Narrow a UI string to an annotation category; falls back to `note`. */
export function asCategory(value: string): AnnotationCategory {
  const parsed = AnnotationCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : 'note';
}

/** Narrow a UI string to a key-storage choice; falls back to `keychain`. */
export function asKeyStorage(value: string): KeyStorage {
  const parsed = KeyStorageSchema.safeParse(value);
  return parsed.success ? parsed.data : 'keychain';
}
