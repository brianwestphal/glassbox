/**
 * Map a raw AI-analysis error string (HTTP status text, fetch failure, SDK
 * message, …) to a short, user-facing sentence. Shared by every client-side
 * analysis trigger (risk/narrative sort modes and guided review) so the
 * wording stays consistent across surfaces.
 */
export function friendlyError(raw: string): string {
  if (raw.includes('429') || raw.toLowerCase().includes('rate_limit') || raw.toLowerCase().includes('rate limit')) {
    return 'Rate limit exceeded. Please wait a moment and try again.';
  }
  if (raw.includes('401') || raw.toLowerCase().includes('unauthorized')) {
    return 'Invalid API key. Check your AI settings.';
  }
  if (raw.includes('403') || raw.toLowerCase().includes('forbidden')) {
    return 'Access denied. Check your API key permissions.';
  }
  if (/\b(500|502|503|504)\b/.test(raw)) {
    return 'AI service temporarily unavailable. Try again later.';
  }
  if (raw.toLowerCase().includes('fetch failed') || raw.toLowerCase().includes('network')) {
    return 'Network error. Check your internet connection.';
  }
  if (raw.toLowerCase().includes('timed out')) {
    return 'Analysis timed out. Try again.';
  }
  return raw.length > 120 ? raw.slice(0, 120) + '...' : raw;
}
