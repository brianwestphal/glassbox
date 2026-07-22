/**
 * Test-only Glassbox content plugin (doc 29, GB-1043). Renders a `.fdiag` file to
 * a fixed, inert SVG so the file-diff render path (GB-1052) can be driven by a
 * committed Playwright e2e without depending on a heavy real renderer.
 *
 * Self-contained ESM (no dependencies): loaded from `<config>/plugins/` exactly
 * like a real installed plugin. The Playwright harness copies this folder into a
 * disposable per-run plugins dir before booting a `--diff` server against a
 * `.fdiag` pair (see `playwright.config.ts`).
 */
export default {
  activate(context) {
    context.log('info', 'fixture-diagram plugin activated (.fdiag)');
    return {
      renderers: [
        {
          name: 'fixture-diagram',
          match: { extensions: ['.fdiag'] },
          render(input) {
            const text = typeof input.text === 'string' ? input.text : '';
            const side = input.side || 'single';
            // Inert SVG: no <script>, no external references. The content varies by
            // side + source length so the old and new sides produce distinct
            // images for the comparison view. A stable `fdiag` marker lets the test
            // assert the served bytes are this plugin's output.
            const svg =
              '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60">' +
              '<rect width="200" height="60" fill="#2b6cb0"/>' +
              '<text x="10" y="35" fill="#ffffff" font-family="monospace" font-size="14">' +
              'fdiag ' + side + ' len=' + text.length +
              '</text></svg>';
            return { svg };
          },
        },
      ],
    };
  },
};
