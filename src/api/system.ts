/**
 * Typed API for OS-shell operations the browser/webview can't perform itself.
 *
 * `open-external` opens a URL in the user's default browser via the local
 * server's `openOS` helper — the same mechanism behind "reveal in finder"
 * (see `src/routes/api/files.ts`). It exists because inside the Tauri desktop
 * shell an anchor's `target="_blank"` never reaches a real browser, so the
 * Sponsor link (and any future outbound link) routes through here instead.
 */
import { z } from 'zod';

import { apiCall, OkResponseSchema } from './_runner.js';

export const OpenExternalReqSchema = z.object({
  // Restricted to http(s): this hands the value to the OS "open" handler, so
  // we don't want to let it launch arbitrary schemes (file:, custom apps).
  url: z.url().refine((u) => /^https?:\/\//i.test(u), {
    message: 'url must be an http(s) URL',
  }),
});
export type OpenExternalReq = z.infer<typeof OpenExternalReqSchema>;

export const OpenExternalRespSchema = OkResponseSchema;
export type OpenExternalResp = z.infer<typeof OpenExternalRespSchema>;

export async function openExternal(req: OpenExternalReq): Promise<OpenExternalResp> {
  return apiCall(OpenExternalRespSchema, '/open-external', { method: 'POST', body: req });
}
