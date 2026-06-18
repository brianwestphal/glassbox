/**
 * GB-909 — the safe inline-markdown renderer for AI note bodies. The security
 * cases (escape-first, scheme-gated links) are the point of these tests.
 */
import { describe, expect, it } from 'vitest';

import { renderNoteMarkdown } from '../../../src/utils/noteMarkdown.js';

describe('renderNoteMarkdown — formatting', () => {
  it('renders inline code, bold, and italic', () => {
    expect(renderNoteMarkdown('use `foo()` here')).toContain('<code>foo()</code>');
    expect(renderNoteMarkdown('this is **important**')).toContain('<strong>important</strong>');
    expect(renderNoteMarkdown('a _subtle_ point')).toContain('<em>subtle</em>');
    expect(renderNoteMarkdown('a *subtle* point')).toContain('<em>subtle</em>');
  });

  it('renders http(s)/mailto links with safe attributes', () => {
    const out = renderNoteMarkdown('see [the docs](https://example.com/x)');
    expect(out).toContain('<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">the docs</a>');
    expect(renderNoteMarkdown('[mail](mailto:a@b.com)')).toContain('href="mailto:a@b.com"');
  });

  it('turns newlines into <br>', () => {
    expect(renderNoteMarkdown('line one\nline two')).toBe('line one<br>line two');
  });

  it('leaves plain prose as escaped text', () => {
    expect(renderNoteMarkdown('just some words')).toBe('just some words');
  });
});

describe('renderNoteMarkdown — security', () => {
  it('escapes raw HTML so markup never reaches the DOM', () => {
    const out = renderNoteMarkdown('<script>alert(1)</script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('escapes an onerror image payload', () => {
    const out = renderNoteMarkdown('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('does NOT render a javascript: link — degrades to literal text', () => {
    const out = renderNoteMarkdown('[click](javascript:alert(1))');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('javascript:alert(1)"');
    expect(out).toContain('[click](javascript:alert(1))');
  });

  it('does NOT render a data: link', () => {
    const out = renderNoteMarkdown('[x](data:text/html,<script>alert(1)</script>)');
    expect(out).not.toContain('<a ');
  });

  it('escapes quotes inside the body', () => {
    expect(renderNoteMarkdown('he said "hi"')).toBe('he said &quot;hi&quot;');
  });
});
