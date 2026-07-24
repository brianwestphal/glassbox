/**
 * GB-1096 — the plain-text rendering written into SARIF `message.text` beside
 * the markdown source, so a viewer that can't render formatting shows prose
 * rather than raw markers (SARIF §3.11.3 / §3.11.9).
 */
import { describe, expect, it } from 'vitest';

import { flattenMarkdown } from '../../../src/utils/flattenMarkdown.js';

describe('flattenMarkdown', () => {
  it('strips ATX heading markers, including a closing sequence', () => {
    expect(flattenMarkdown('### Root cause')).toBe('Root cause');
    expect(flattenMarkdown('# Title ###')).toBe('Title');
  });

  it('strips emphasis and code-span markers, keeping their content', () => {
    expect(flattenMarkdown('the **guard** was `null`')).toBe('the guard was null');
    expect(flattenMarkdown('a _subtle_ and *subtle* point')).toBe('a subtle and subtle point');
  });

  it('keeps a link\'s destination alongside its text', () => {
    expect(flattenMarkdown('see [the docs](https://example.com/x)')).toBe('see the docs (https://example.com/x)');
  });

  it('keeps list, blockquote, and thematic-break markers — they read as plain text', () => {
    expect(flattenMarkdown('- first\n- second')).toBe('- first\n- second');
    expect(flattenMarkdown('1. one')).toBe('1. one');
    expect(flattenMarkdown('> quoted')).toBe('> quoted');
    expect(flattenMarkdown('---')).toBe('---');
  });

  it('drops code fences but keeps their contents verbatim', () => {
    expect(flattenMarkdown('```sh\nnpm test -- **all**\n```')).toBe('npm test -- **all**');
    expect(flattenMarkdown('~~~\nx\n~~~')).toBe('x');
  });

  it('leaves plain prose and blank lines untouched', () => {
    expect(flattenMarkdown('just words')).toBe('just words');
    expect(flattenMarkdown('a\n\nb')).toBe('a\n\nb');
    expect(flattenMarkdown('')).toBe('');
  });

  it('flattens a realistic multi-block body', () => {
    const body = [
      '### Root cause',
      '',
      'The guard was **missing**.',
      '',
      '- `SET` carries `EX 3600`',
      '',
      '```sh',
      'npm test',
      '```',
    ].join('\n');

    expect(flattenMarkdown(body)).toBe([
      'Root cause',
      '',
      'The guard was missing.',
      '',
      '- SET carries EX 3600',
      '',
      'npm test',
    ].join('\n'));
  });
});
