import { z } from 'zod';

// --- Client-side debug logging (sends to server console when --debug is active) ---

let debugEnabled: boolean | null = null; // null = not yet checked

const DebugStatusSchema = z.object({ enabled: z.boolean() }).loose();

/** Initialize debug state by checking the server. Call once at startup. */
export async function initDebug(): Promise<void> {
  try {
    const res = await fetch('/api/ai/debug-status');
    debugEnabled = DebugStatusSchema.parse(await res.json()).enabled;
  } catch {
    debugEnabled = false;
  }
}

/** Fire-and-forget debug log to server console. No-op if debug is off. */
export function clientLog(message: string): void {
  if (debugEnabled !== true) return;
  void fetch('/api/ai/debug-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}
