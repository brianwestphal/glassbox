export function Layout({ title, reviewId, children }: { title: string; reviewId: string; children?: unknown }) {
  return (
    <html lang="en">
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
