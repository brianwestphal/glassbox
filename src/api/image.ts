/**
 * Typed API for image-diff endpoints. Metadata returns JSON; the per-side
 * binary fetch isn't a `fetch()` call — the UI sets it as an `<img src>`
 * — so this module exposes a URL builder (`imageUrl`) instead of a typed
 * caller for that endpoint.
 */
import { api } from './_runner.js';

export type ImageSide = 'old' | 'new';

export interface GetImageMetadataReq { fileId: string }
export interface GetImageMetadataResp {
  old: string[] | null;
  new: string[] | null;
}

export async function getImageMetadata(req: GetImageMetadataReq): Promise<GetImageMetadataResp> {
  return api<GetImageMetadataResp>(`/image/${req.fileId}/metadata`);
}

/** Build the `<img src>` URL for one side of an image diff. Not a fetch
 *  helper — the response is binary and goes through the browser's image
 *  loader, not the JSON `api()` helper. */
export function imageUrl(req: { fileId: string; side: ImageSide }): string {
  return `/api/image/${req.fileId}/${req.side}`;
}
