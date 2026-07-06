/**
 * Build/kill-switch flags. Flipping one to `false` removes a whole subsystem
 * wholesale — no discovery, no loading, no dispatch — without deleting code
 * (doc 29 NFR-29.4; mirrors Hot Sheet's `PLUGINS_ENABLED`).
 *
 * `GLASSBOX_PLUGINS_DISABLED=1` in the environment forces the content-plugin
 * subsystem off at runtime as well (used by the e2e suite so a stray plugin in
 * the developer's `~/.glassbox/plugins/` can't perturb a hermetic run).
 */
export const PLUGINS_ENABLED: boolean = process.env.GLASSBOX_PLUGINS_DISABLED === '1' ? false : true;
