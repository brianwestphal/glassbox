import { describe, expect, it } from 'vitest';

import { ensureIntrinsicSvgSize } from '../../../src/plugins/svgSize.js';

describe('ensureIntrinsicSvgSize (doc 29 FR-29.2)', () => {
  it('injects absolute width/height from the viewBox when width is a percentage (the Mermaid case)', () => {
    const svg = '<svg id="my-svg" width="100%" viewBox="-50 -10 779.5 470"><g/></svg>';
    const fixed = ensureIntrinsicSvgSize(svg);
    expect(fixed).toContain('width="779.5"');
    expect(fixed).toContain('height="470"');
    expect(fixed).not.toContain('100%');
    // Content beyond the root tag is untouched.
    expect(fixed).toContain('<g/></svg>');
  });

  it('injects both dimensions when the root has neither', () => {
    const fixed = ensureIntrinsicSvgSize('<svg viewBox="0 0 100 50"></svg>');
    expect(fixed).toContain('width="100"');
    expect(fixed).toContain('height="50"');
  });

  it('leaves an SVG with absolute pixel dimensions untouched', () => {
    const svg = '<svg width="640" height="480" viewBox="0 0 640 480"></svg>';
    expect(ensureIntrinsicSvgSize(svg)).toBe(svg);
  });

  it('treats pt units as intrinsic (the Graphviz / PlantUML case)', () => {
    const svg = '<svg width="62pt" height="116pt" viewBox="0 0 62 116"></svg>';
    expect(ensureIntrinsicSvgSize(svg)).toBe(svg);
  });

  it('fills in only the missing dimension', () => {
    const fixed = ensureIntrinsicSvgSize('<svg width="200" viewBox="0 0 100 50"></svg>');
    expect(fixed).toContain('width="200"');
    expect(fixed).toContain('height="50"');
  });

  it('returns the input unchanged when there is no viewBox to derive from', () => {
    const svg = '<svg width="100%"><rect/></svg>';
    expect(ensureIntrinsicSvgSize(svg)).toBe(svg);
  });

  it('returns the input unchanged on a malformed or degenerate viewBox', () => {
    expect(ensureIntrinsicSvgSize('<svg viewBox="bogus"></svg>')).toBe('<svg viewBox="bogus"></svg>');
    expect(ensureIntrinsicSvgSize('<svg viewBox="0 0 0 0"></svg>')).toBe('<svg viewBox="0 0 0 0"></svg>');
    expect(ensureIntrinsicSvgSize('not svg at all')).toBe('not svg at all');
  });

  it('supports comma-separated viewBox values and preserves a leading XML prolog offset', () => {
    const fixed = ensureIntrinsicSvgSize('<?xml version="1.0"?><svg viewBox="0,0,320,240"></svg>');
    expect(fixed.startsWith('<?xml version="1.0"?>')).toBe(true);
    expect(fixed).toContain('width="320"');
    expect(fixed).toContain('height="240"');
  });

  it('does not confuse a nested element width with the root attributes', () => {
    const fixed = ensureIntrinsicSvgSize('<svg viewBox="0 0 10 20"><rect width="5" height="5"/></svg>');
    expect(fixed).toContain('<svg width="10" height="20" viewBox="0 0 10 20">');
    expect(fixed).toContain('<rect width="5" height="5"/>');
  });
});
