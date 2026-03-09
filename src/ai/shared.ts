/** Shared utilities for AI analysis modules */

export interface NeedContextResponse {
  needContext: string[];
}

export function isNeedContext(parsed: unknown): parsed is NeedContextResponse {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'needContext' in parsed &&
    Array.isArray((parsed as NeedContextResponse).needContext)
  );
}

/** Try to extract JSON from a response that may contain surrounding prose */
export function extractJSON(text: string): unknown {
  const stripped = text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(stripped);
  } catch { /* continue */ }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch !== null) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch { /* continue */ }
  }

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch !== null) {
    try {
      return JSON.parse(objMatch[0]);
    } catch { /* continue */ }
  }

  throw new Error(`Could not extract JSON from AI response: ${text.slice(0, 300)}`);
}
