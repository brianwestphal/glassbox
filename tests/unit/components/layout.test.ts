import { Layout } from '../../../src/components/layout.js';
import { raw } from '../../../src/jsx-runtime.js';

describe('Layout', () => {
  it('renders an HTML page structure', () => {
    const result = Layout({ title: 'Test Page', reviewId: 'r-123' }).toString();
    expect(result).toContain('<html lang="en">');
    expect(result).toContain('<title>Test Page</title>');
    expect(result).toContain('data-review-id="r-123"');
    expect(result).toContain('/static/styles.css');
    expect(result).toContain('/static/app.js');
  });

  it('includes SafeHtml children in the body', () => {
    const result = Layout({ title: 'Test', reviewId: 'r-1', children: raw('<div>Content</div>') }).toString();
    expect(result).toContain('<div>Content</div>');
  });

  it('escapes string children (XSS prevention)', () => {
    const result = Layout({ title: 'Test', reviewId: 'r-1', children: '<script>XSS</script>' }).toString();
    expect(result).not.toContain('<script>XSS</script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes title text', () => {
    const result = Layout({ title: '<script>XSS</script>', reviewId: 'r-1' }).toString();
    expect(result).not.toContain('<script>XSS</script>');
    expect(result).toContain('&lt;script&gt;');
  });
});
