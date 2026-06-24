/**
 * Shared constants for the rough token/char budgeting used across the AI
 * analysis pipeline (context building, batch planning, request logging). These
 * are deliberately approximate — they size prompts conservatively, they are not
 * exact tokenizer counts.
 */

/** Rough bytes-per-token ratio for English-ish source text. Used to convert
 *  between a model's token context window and an approximate character budget. */
export const CHARS_PER_TOKEN = 3;

/** Fraction of a model's context window we spend on input context, leaving the
 *  remainder as headroom for the model's output. */
export const CONTEXT_RESERVE_FRACTION = 0.7;
