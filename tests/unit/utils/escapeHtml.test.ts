import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr } from '../../../src/utils/escapeHtml.js';

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes less than', () => {
    expect(escapeHtml('a<b')).toBe('a&lt;b');
  });

  it('escapes greater than', () => {
    expect(escapeHtml('a>b')).toBe('a&gt;b');
  });

  it('escapes double quote', () => {
    expect(escapeHtml('a"b')).toBe('a&quot;b');
  });

  it('escapes mixed special characters', () => {
    expect(escapeHtml('<div class="foo">&</div>')).toBe(
      '&lt;div class=&quot;foo&quot;&gt;&amp;&lt;/div&gt;',
    );
  });

  it('passes through strings with no special characters', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('escapeAttr', () => {
  it('escapes single quote', () => {
    expect(escapeAttr("a'b")).toBe('a&#39;b');
  });

  it('escapes double quote', () => {
    expect(escapeAttr('a"b')).toBe('a&quot;b');
  });

  it('escapes ampersand', () => {
    expect(escapeAttr('a&b')).toBe('a&amp;b');
  });

  it('escapes less than', () => {
    expect(escapeAttr('a<b')).toBe('a&lt;b');
  });

  it('escapes greater than', () => {
    expect(escapeAttr('a>b')).toBe('a&gt;b');
  });

  it('escapes mixed special characters', () => {
    expect(escapeAttr('<"foo">&\'bar\'')).toBe(
      '&lt;&quot;foo&quot;&gt;&amp;&#39;bar&#39;',
    );
  });

  it('returns empty string for empty input', () => {
    expect(escapeAttr('')).toBe('');
  });

  it('passes through strings with no special characters', () => {
    expect(escapeAttr('hello world')).toBe('hello world');
  });
});
