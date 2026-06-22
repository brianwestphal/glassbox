import { describe, expect, it } from 'vitest';

import { mimeForFilename } from '../../../src/utils/mime.js';

// doc 25 — fallback MIME lookup for attachments when the browser doesn't send one.
describe('mimeForFilename', () => {
  it('maps common extensions (case-insensitive)', () => {
    expect(mimeForFilename('shot.PNG')).toBe('image/png');
    expect(mimeForFilename('a.jpg')).toBe('image/jpeg');
    expect(mimeForFilename('spec.pdf')).toBe('application/pdf');
    expect(mimeForFilename('run.log')).toBe('text/plain');
    expect(mimeForFilename('data.json')).toBe('application/json');
    expect(mimeForFilename('clip.mp4')).toBe('video/mp4');
  });

  it('falls back to octet-stream for unknown / extensionless names', () => {
    expect(mimeForFilename('mystery.qqq')).toBe('application/octet-stream');
    expect(mimeForFilename('Makefile')).toBe('application/octet-stream');
    expect(mimeForFilename('archive.tar.unknown')).toBe('application/octet-stream');
  });
});
