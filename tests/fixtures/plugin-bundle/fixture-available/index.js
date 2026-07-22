/**
 * Test-only opt-in content plugin (doc 29 §29.2, GB-1070). Self-contained — no
 * `install` descriptor, so `installAvailablePlugin` treats it as a pure copy and
 * the Available-to-install e2e can install it with one click and see it reach
 * `ready` + move to the installed list. It renders `.favail` to a tiny inert SVG.
 */
export default {
  activate(context) {
    context.log('info', 'fixture-available plugin activated (.favail)');
    return {
      renderers: [
        {
          name: 'fixture-available',
          match: { extensions: ['.favail'] },
          render() {
            return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="#3fb950"/></svg>' };
          },
        },
      ],
    };
  },
};
