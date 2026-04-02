import { themeToInlineStyle } from '../themes/built-in.js';
import { getActiveThemeColors, getActiveThemeId } from '../themes/config.js';

export function Layout({ title, reviewId, children }: { title: string; reviewId: string; children?: unknown }) {
  const themeId = getActiveThemeId();
  const themeColors = getActiveThemeColors();
  const themeStyle = themeToInlineStyle(themeColors);

  return (
    <html lang="en" style={themeStyle} data-theme={themeId}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/static/styles.css" />
      </head>
      <body data-review-id={reviewId}>
        {children}
        <script src="/static/app.js"></script>
      </body>
    </html>
  );
}
