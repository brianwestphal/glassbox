import {
  IconActualSize, IconBook, IconCheck, IconDownload, IconEdit,
  IconFit, IconFlask, IconFolder, IconGear, IconRefresh,
  IconReveal, IconShield, IconSliders, IconTrash, IconTrash16,
  IconZoomIn, IconZoomOut,
} from '../../src/icons.js';

const icons = [
  ['IconEdit', IconEdit],
  ['IconTrash', IconTrash],
  ['IconTrash16', IconTrash16],
  ['IconCheck', IconCheck],
  ['IconReveal', IconReveal],
  ['IconZoomOut', IconZoomOut],
  ['IconZoomIn', IconZoomIn],
  ['IconFit', IconFit],
  ['IconActualSize', IconActualSize],
  ['IconFolder', IconFolder],
  ['IconShield', IconShield],
  ['IconBook', IconBook],
  ['IconRefresh', IconRefresh],
  ['IconGear', IconGear],
  ['IconSliders', IconSliders],
  ['IconFlask', IconFlask],
  ['IconDownload', IconDownload],
] as const;

describe('icons', () => {
  it.each(icons)('%s returns valid SVG SafeHtml', (name, fn) => {
    const html = fn().toString();
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
    expect(html).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('IconActualSize includes 1:1 text element', () => {
    expect(IconActualSize().toString()).toContain('1:1');
  });

  it('IconEdit uses 14x14 size', () => {
    expect(IconEdit().toString()).toContain('width="14"');
  });

  it('IconTrash16 uses 16x16 size', () => {
    expect(IconTrash16().toString()).toContain('width="16"');
  });

  it('IconReveal uses 12x12 size', () => {
    expect(IconReveal().toString()).toContain('width="12"');
  });
});
