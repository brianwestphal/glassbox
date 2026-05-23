/**
 * Typed API for image-diff endpoints. Metadata returns JSON; the per-side
 * binary fetch isn't a `fetch()` call — the UI sets it as an `<img src>`
 * — so this module exposes a URL builder (`imageUrl`) instead of a typed
 * caller for that endpoint.
 */
import { z } from 'zod';

import { apiCall } from './_runner.js';

export const ImageSideSchema = z.enum(['old', 'new']);
export type ImageSide = z.infer<typeof ImageSideSchema>;

export const GetImageMetadataReqSchema = z.object({ fileId: z.string() });
export type GetImageMetadataReq = z.infer<typeof GetImageMetadataReqSchema>;

export const GetImageMetadataRespSchema = z.object({
  old: z.array(z.string()).nullable(),
  new: z.array(z.string()).nullable(),
});
export type GetImageMetadataResp = z.infer<typeof GetImageMetadataRespSchema>;

export async function getImageMetadata(req: GetImageMetadataReq): Promise<GetImageMetadataResp> {
  return apiCall(GetImageMetadataRespSchema, `/image/${req.fileId}/metadata`);
}

/** Build the `<img src>` URL for one side of an image diff. Not a fetch
 *  helper — the response is binary and goes through the browser's image
 *  loader, not the JSON `apiCall()` helper. */
export function imageUrl(req: { fileId: string; side: ImageSide }): string {
  return `/api/image/${req.fileId}/${req.side}`;
}
