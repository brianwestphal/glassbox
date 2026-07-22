/**
 * Test-only Glassbox content plugin (doc 29, GB-1043 / GB-1070). Renders a
 * `.fdiag` file to a fixed, inert SVG so the file-diff render path (GB-1052) can
 * be driven by a committed Playwright e2e without a heavy real renderer, AND
 * declares the management-tab surfaces (a preference, a config-layout group with a
 * status label + a Test button, and a diff-toolbar UI extension) so the
 * Settings → Plugins tab e2e (GB-1070) can drive them.
 *
 * Self-contained ESM (no dependencies): loaded from `<config>/plugins/` exactly
 * like a real installed plugin. The Playwright harness copies this folder into a
 * disposable per-run plugins dir before booting a `--diff` server against a
 * `.fdiag` pair (see `playwright.config.ts`).
 */
export default {
  async activate(context) {
    const tint = (await context.getSetting('tint')) || 'blue';
    context.log('info', 'fixture-diagram plugin activated (.fdiag), tint=' + tint);
    // Reference UI extension (doc 30): a diff-toolbar button whose action toasts.
    context.registerUI([
      { type: 'button', id: 'fixture-ping', location: 'diff-toolbar', label: 'Fixture', title: 'Ping the fixture plugin', action: 'ping' },
    ]);
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

  // Config-layout button (doc 29 FR-29.18) + diff-toolbar UI element (doc 30).
  onAction(actionId, context) {
    if (actionId === 'test') {
      context.updateConfigLabel('fixture-status', 'Renderer OK', 'success');
      return { message: 'Fixture renderer OK' };
    }
    if (actionId === 'ping') return { message: 'Fixture pinged' };
  },
};
