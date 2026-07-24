/**
 * GB-909 / GB-1094 — the safe markdown renderer for AI note bodies. The
 * security cases (escape-first, scheme-gated links, no HTML ever reaching the
 * DOM) are the point of these tests; the block cases pin the subset producers
 * are told they can rely on.
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

  it('keeps a newline inside a paragraph as a visible break', () => {
    expect(renderNoteMarkdown('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });

  it('leaves plain prose as escaped text in a single paragraph', () => {
    expect(renderNoteMarkdown('just some words')).toBe('<p>just some words</p>');
  });

  it('renders nothing for an empty body', () => {
    expect(renderNoteMarkdown('')).toBe('');
    expect(renderNoteMarkdown('\n\n')).toBe('');
  });

  it('splits blank-line-separated prose into separate paragraphs', () => {
    expect(renderNoteMarkdown('first\n\nsecond')).toBe('<p>first</p><p>second</p>');
  });
});

describe('renderNoteMarkdown — block markdown (GB-1094)', () => {
  it('renders ATX headings starting at h4 so a note never outranks page chrome', () => {
    expect(renderNoteMarkdown('# Title')).toBe('<h4>Title</h4>');
    expect(renderNoteMarkdown('## Sub')).toBe('<h5>Sub</h5>');
    expect(renderNoteMarkdown('### Deep')).toBe('<h6>Deep</h6>');
  });

  it('clamps heading depth at h6 rather than emitting an h7', () => {
    expect(renderNoteMarkdown('###### Deepest')).toBe('<h6>Deepest</h6>');
  });

  it('applies inline formatting inside a heading and strips a closing sequence', () => {
    expect(renderNoteMarkdown('# The `guard` ###')).toBe('<h4>The <code>guard</code></h4>');
  });

  it('does not treat a bare # without a space as a heading', () => {
    expect(renderNoteMarkdown('#hashtag')).toBe('<p>#hashtag</p>');
  });

  it('renders an unordered list', () => {
    expect(renderNoteMarkdown('- first\n- second')).toBe('<ul><li>first</li><li>second</li></ul>');
    expect(renderNoteMarkdown('* star\n+ plus')).toContain('<li>star</li>');
  });

  it('renders an ordered list, preserving a non-1 start', () => {
    expect(renderNoteMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
    expect(renderNoteMarkdown('3. three')).toBe('<ol start="3"><li>three</li></ol>');
  });

  it('nests a sub-list inside its parent item', () => {
    expect(renderNoteMarkdown('- outer\n  - inner')).toBe('<ul><li>outer<ul><li>inner</li></ul></li></ul>');
  });

  it('attaches an indented continuation line to its item', () => {
    expect(renderNoteMarkdown('- item\n  more text')).toBe('<ul><li>item<br>more text</li></ul>');
  });

  it('renders a fenced code block without formatting its contents', () => {
    const out = renderNoteMarkdown('```ts\nconst a = **not bold**;\n```');
    expect(out).toBe('<pre><code>const a = **not bold**;</code></pre>');
  });

  it('does not treat a heading-looking line inside a fence as a heading', () => {
    expect(renderNoteMarkdown('```sh\n# a shell comment\n```')).toBe('<pre><code># a shell comment</code></pre>');
  });

  it('supports a tilde fence and an unterminated fence', () => {
    expect(renderNoteMarkdown('~~~\nx\n~~~')).toBe('<pre><code>x</code></pre>');
    expect(renderNoteMarkdown('```\nunterminated')).toBe('<pre><code>unterminated</code></pre>');
  });

  it('renders a blockquote', () => {
    expect(renderNoteMarkdown('> quoted\n> more')).toBe('<blockquote><p>quoted<br>more</p></blockquote>');
  });

  it('renders a thematic break, and does not mistake one for a list', () => {
    expect(renderNoteMarkdown('a\n\n---\n\nb')).toBe('<p>a</p><hr><p>b</p>');
    expect(renderNoteMarkdown('- - -')).toBe('<hr>');
  });

  it('lets a block interrupt a paragraph', () => {
    expect(renderNoteMarkdown('prose\n- item')).toBe('<p>prose</p><ul><li>item</li></ul>');
  });

  it('renders a realistic multi-block body', () => {
    const out = renderNoteMarkdown([
      '### Root cause',
      '',
      'The guard was **missing**.',
      '',
      '- first',
      '- second',
      '',
      '```sh',
      'npm test',
      '```',
    ].join('\n'));

    expect(out).toBe(
      '<h6>Root cause</h6>'
      + '<p>The guard was <strong>missing</strong>.</p>'
      + '<ul><li>first</li><li>second</li></ul>'
      + '<pre><code>npm test</code></pre>'
    );
  });
});

/**
 * SARIF §3.11.6 embedded links: a link whose destination is a non-negative
 * integer indexing `result.relatedLocations` (GB-1097).
 */
describe('renderNoteMarkdown — embedded links', () => {
  const RELATED = [{ uri: 'src/auth/session.ts', line: 42 }, { uri: 'src/db/redis.ts', line: 7 }];

  it('resolves an integer destination to a jump-to-line anchor', () => {
    const out = renderNoteMarkdown('see [the caller](0)', RELATED);
    expect(out).toBe('<p>see <a class="ai-note-loclink" data-loc-file="src/auth/session.ts" data-loc-line="42" title="src/auth/session.ts:42">the caller</a></p>');
  });

  it('indexes into the array, not by position of the link', () => {
    expect(renderNoteMarkdown('[a](1) then [b](0)', RELATED)).toContain('data-loc-file="src/db/redis.ts" data-loc-line="7"');
  });

  it('carries no href, so there is nothing to navigate to on a plain click', () => {
    expect(renderNoteMarkdown('[x](0)', RELATED)).not.toContain('href');
  });

  it('leaves an out-of-range index as literal text', () => {
    expect(renderNoteMarkdown('[x](9)', RELATED)).toBe('<p>[x](9)</p>');
  });

  it('leaves an integer destination literal when the note has no related locations', () => {
    expect(renderNoteMarkdown('[x](0)')).toBe('<p>[x](0)</p>');
  });

  it('leaves a placeholder (unusable) related entry as literal text', () => {
    // The reader emits a placeholder rather than dropping an unusable entry, so
    // later indices still line up; the renderer must not link to it.
    expect(renderNoteMarkdown('[x](0)', [{ uri: '', line: 0 }])).toBe('<p>[x](0)</p>');
  });

  it('still renders http(s) links normally alongside embedded ones', () => {
    const out = renderNoteMarkdown('[here](0) and [there](https://example.com)', RELATED);
    expect(out).toContain('data-loc-file="src/auth/session.ts"');
    expect(out).toContain('href="https://example.com"');
  });

  it('attribute-escapes a related uri, which does not come from the escaped body', () => {
    const out = renderNoteMarkdown('[x](0)', [{ uri: 'a"><img src=x onerror=alert(1)>.ts', line: 1 }]);
    expect(out).not.toContain('<img');
    expect(out).toContain('&quot;&gt;&lt;img');
  });

  it('resolves an embedded link inside a list item', () => {
    expect(renderNoteMarkdown('- see [it](0)', RELATED)).toContain('<li>see <a class="ai-note-loclink"');
  });
});

describe('renderNoteMarkdown — security', () => {
  it('escapes raw HTML so markup never reaches the DOM', () => {
    const out = renderNoteMarkdown('<script>alert(1)</script>');
    expect(out).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
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
    expect(renderNoteMarkdown('he said "hi"')).toBe('<p>he said &quot;hi&quot;</p>');
  });

  it('escapes HTML inside a fenced code block', () => {
    const out = renderNoteMarkdown('```\n<script>alert(1)</script>\n```');
    expect(out).toBe('<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
    expect(out).not.toContain('<script>');
  });

  it('escapes HTML inside a list item and a heading', () => {
    expect(renderNoteMarkdown('- <img src=x onerror=alert(1)>')).not.toContain('<img');
    expect(renderNoteMarkdown('# <b>bold</b>')).not.toContain('<b>');
  });

  /**
   * SARIF §3.11.4 requires consumers to be hardened against deeply nested
   * markup overflowing the markdown processor's stack. Recursion is depth
   * capped, so pathological nesting degrades to flat text instead of throwing.
   */
  it('survives pathologically nested lists without throwing', () => {
    const deep = Array.from({ length: 200 }, (_, i) => `${' '.repeat(i * 2)}- level ${String(i)}`).join('\n');
    let out = '';
    expect(() => { out = renderNoteMarkdown(deep); }).not.toThrow();
    expect(out).toContain('level 199');
  });

  it('survives deeply nested blockquotes without throwing', () => {
    const deep = `${'> '.repeat(200)}bottom`;
    expect(() => renderNoteMarkdown(deep)).not.toThrow();
    expect(renderNoteMarkdown(deep)).toContain('bottom');
  });
});
