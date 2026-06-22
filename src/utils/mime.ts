/**
 * Minimal extension → MIME-type lookup for reviewer attachments (doc 25).
 *
 * The browser usually supplies a File's MIME type on upload; this is the
 * fallback when it doesn't (some OS/file combos send an empty type) and the
 * source of truth for serving the bytes back with a sensible `Content-Type`
 * (so images/PDFs preview in-tab). Unknown types fall back to a generic
 * octet-stream — never a wrong, "trust me" type.
 */

const MIME_BY_EXT: Record<string, string> = {
  // images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp',
  ico: 'image/x-icon', heic: 'image/heic', tiff: 'image/tiff', tif: 'image/tiff',
  // documents
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml',
  html: 'text/html', log: 'text/plain', rtf: 'application/rtf',
  // archives
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  // audio / video
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

export function mimeForFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
