import { themeToInlineStyle } from '../themes/built-in.js';
import { getActiveThemeColors, getActiveThemeId } from '../themes/config.js';

export function Layout({ title, reviewId, difftool, children }: { title: string; reviewId: string; difftool?: boolean; children?: unknown }) {
  const themeId = getActiveThemeId();
  const themeColors = getActiveThemeColors();
  const themeStyle = themeToInlineStyle(themeColors);

  return (
    <html lang="en" style={themeStyle} data-theme={themeId}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="stylesheet" href="/static/styles.css" />
      </head>
      <body data-review-id={reviewId} data-difftool={difftool === true ? '1' : undefined}>
        {children}
        <script src="/static/app.js"></script>
      </body>
    </html>
  );
}
