import { describe, it, expect } from 'vitest';
import { SafeHtml, jsx, jsxs, Fragment, raw } from '../../../src/jsx-runtime.js';

describe('SafeHtml', () => {
  it('constructor stores html string', () => {
    const html = new SafeHtml('<div>hello</div>');
    expect(html.__html).toBe('<div>hello</div>');
  });

  it('toString returns the html string', () => {
    const html = new SafeHtml('<p>test</p>');
    expect(html.toString()).toBe('<p>test</p>');
  });
});

describe('raw', () => {
  it('wraps a string in SafeHtml', () => {
    const result = raw('<b>bold</b>');
    expect(result).toBeInstanceOf(SafeHtml);
    expect(result.__html).toBe('<b>bold</b>');
  });
});

describe('jsx', () => {
  it('renders a simple element with text child', () => {
    const result = jsx('div', { children: 'hello' });
    expect(result).toBeInstanceOf(SafeHtml);
    expect(result.toString()).toBe('<div>hello</div>');
  });

  it('escapes string children to prevent XSS', () => {
    const result = jsx('p', { children: '<script>alert(1)</script>' });
    expect(result.toString()).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('renders attributes on elements', () => {
    const result = jsx('input', { type: 'text', id: 'foo' });
    expect(result.toString()).toBe('<input type="text" id="foo">');
  });

  it('maps className to class attribute', () => {
    const result = jsx('div', { className: 'foo' });
    expect(result.toString()).toBe('<div class="foo"></div>');
  });

  it('maps htmlFor to for attribute', () => {
    const result = jsx('label', { htmlFor: 'bar' });
    expect(result.toString()).toBe('<label for="bar"></label>');
  });

  it('renders boolean true attribute as bare attribute', () => {
    const result = jsx('input', { disabled: true });
    expect(result.toString()).toBe('<input disabled>');
  });

  it('omits boolean false attribute', () => {
    const result = jsx('input', { disabled: false });
    expect(result.toString()).toBe('<input>');
  });

  it('omits null attribute', () => {
    const result = jsx('div', { id: null });
    expect(result.toString()).toBe('<div></div>');
  });

  it('omits undefined attribute', () => {
    const result = jsx('div', { id: undefined });
    expect(result.toString()).toBe('<div></div>');
  });

  it('renders void tag without closing tag', () => {
    const result = jsx('br', {});
    expect(result.toString()).toBe('<br>');
  });

  it('renders void tag with attributes and no closing tag', () => {
    const result = jsx('img', { src: 'x.png' });
    expect(result.toString()).toBe('<img src="x.png">');
  });

  it('renders null children as empty element', () => {
    const result = jsx('div', { children: null });
    expect(result.toString()).toBe('<div></div>');
  });

  it('renders undefined children as empty element', () => {
    const result = jsx('div', { children: undefined });
    expect(result.toString()).toBe('<div></div>');
  });

  it('renders boolean children as empty element', () => {
    const result = jsx('div', { children: true });
    expect(result.toString()).toBe('<div></div>');
  });

  it('renders number children as string', () => {
    const result = jsx('div', { children: 42 });
    expect(result.toString()).toBe('<div>42</div>');
  });

  it('renders array children', () => {
    const result = jsx('ul', {
      children: [new SafeHtml('<li>1</li>'), new SafeHtml('<li>2</li>')],
    });
    expect(result.toString()).toBe('<ul><li>1</li><li>2</li></ul>');
  });

  it('renders raw() inside children without escaping', () => {
    const result = jsx('div', { children: raw('<b>bold</b>') });
    expect(result.toString()).toBe('<div><b>bold</b></div>');
  });

  it('renders nested SafeHtml children', () => {
    const result = jsx('div', { children: new SafeHtml('<span>inner</span>') });
    expect(result.toString()).toBe('<div><span>inner</span></div>');
  });

  it('renders function component', () => {
    const MyComponent = (props: { name: string }) =>
      new SafeHtml(`<custom>${props.name}</custom>`);
    const result = jsx(MyComponent, { name: 'test' });
    expect(result.toString()).toBe('<custom>test</custom>');
  });

  it('escapes attribute values with double quotes', () => {
    const result = jsx('div', { title: 'a"b' });
    expect(result.toString()).toBe('<div title="a&quot;b"></div>');
  });

  it('escapes attribute values with ampersands', () => {
    const result = jsx('div', { title: 'a&b' });
    expect(result.toString()).toBe('<div title="a&amp;b"></div>');
  });

  it('escapes attribute values with single quotes', () => {
    const result = jsx('div', { title: "a'b" });
    expect(result.toString()).toBe('<div title="a&#39;b"></div>');
  });

  it('renders element with no props besides children', () => {
    const result = jsx('span', { children: 'text' });
    expect(result.toString()).toBe('<span>text</span>');
  });

  it('renders element with no children and no attributes', () => {
    const result = jsx('div', {});
    expect(result.toString()).toBe('<div></div>');
  });

  it('renders multiple void tags correctly', () => {
    for (const tag of ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']) {
      const result = jsx(tag, {});
      expect(result.toString()).toBe(`<${tag}>`);
    }
  });

  it('renders numeric attribute values', () => {
    const result = jsx('input', { tabindex: 3 });
    expect(result.toString()).toBe('<input tabindex="3">');
  });
});

describe('jsxs', () => {
  it('is the same function as jsx', () => {
    expect(jsxs).toBe(jsx);
  });

  it('renders identically to jsx', () => {
    const result = jsxs('div', { children: ['a', 'b'] });
    expect(result.toString()).toBe(jsx('div', { children: ['a', 'b'] }).toString());
  });
});

describe('Fragment', () => {
  it('renders children without a wrapper element', () => {
    const result = Fragment({
      children: [new SafeHtml('<span>a</span>'), new SafeHtml('<span>b</span>')],
    });
    expect(result).toBeInstanceOf(SafeHtml);
    expect(result.toString()).toBe('<span>a</span><span>b</span>');
  });

  it('renders a single child', () => {
    const result = Fragment({ children: new SafeHtml('<p>only</p>') });
    expect(result.toString()).toBe('<p>only</p>');
  });

  it('renders empty when no children provided', () => {
    const result = Fragment({});
    expect(result.toString()).toBe('');
  });

  it('renders empty for null children', () => {
    const result = Fragment({ children: null });
    expect(result.toString()).toBe('');
  });

  it('renders empty for undefined children', () => {
    const result = Fragment({ children: undefined });
    expect(result.toString()).toBe('');
  });

  it('escapes string children', () => {
    const result = Fragment({ children: '<b>not bold</b>' });
    expect(result.toString()).toBe('&lt;b&gt;not bold&lt;/b&gt;');
  });
});
