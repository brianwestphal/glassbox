/**
 * Content-plugin management API (doc 29, GB-1040): list installed plugins with
 * their state, toggle enablement (global / per-project), install from a
 * directory, and uninstall. Every mutation reloads the subsystem so the change
 * takes effect immediately, and returns the refreshed list.
 */
import { Hono } from 'hono';

import { InstallPluginReqSchema, RunPluginActionReqSchema, SetPluginDisabledReqSchema, SetPluginPreferenceReqSchema } from '../../api/plugins.js';
import { setGlobalDisabled, setProjectDisabled } from '../../plugins/enablement.js';
import { describeInstalledPlugins, getPluginManifest, reloadContentPlugins, runPluginAction } from '../../plugins/index.js';
import { installPluginFromDisk, uninstallPlugin } from '../../plugins/install.js';
import { clearConfigLabelOverrides } from '../../plugins/loader.js';
import { writePluginSetting } from '../../plugins/settings.js';
import type { AppEnv } from '../../types.js';
import { parseBody, requirePathParam } from '../../utils/parseBody.js';

export const pluginsRoutes = new Hono<AppEnv>();

pluginsRoutes.get('/plugins', (c) => {
  return c.json({ plugins: describeInstalledPlugins(c.get('repoRoot')) });
});

pluginsRoutes.post('/plugins/:id/disabled', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  const parsed = await parseBody(c, SetPluginDisabledReqSchema);
  if (!parsed.ok) return parsed.response;

  const repoRoot = c.get('repoRoot');
  if (parsed.data.scope === 'global') setGlobalDisabled(id.data, parsed.data.disabled);
  else setProjectDisabled(repoRoot, id.data, parsed.data.disabled);
  await reloadContentPlugins(repoRoot);
  return c.json({ plugins: describeInstalledPlugins(repoRoot) });
});

pluginsRoutes.post('/plugins/install', async (c) => {
  const parsed = await parseBody(c, InstallPluginReqSchema);
  if (!parsed.ok) return parsed.response;

  const repoRoot = c.get('repoRoot');
  try {
    installPluginFromDisk(parsed.data.path);
  } catch (e) {
    // Return the current list + the message so the client (whose apiCall
    // validates the body regardless of status) can show a clean error instead
    // of a schema-validation failure (GB-1048).
    return c.json({ plugins: describeInstalledPlugins(repoRoot), error: e instanceof Error ? e.message : 'Install failed' }, 400);
  }
  await reloadContentPlugins(repoRoot);
  return c.json({ plugins: describeInstalledPlugins(repoRoot) });
});

pluginsRoutes.post('/plugins/:id/preferences', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  const parsed = await parseBody(c, SetPluginPreferenceReqSchema);
  if (!parsed.ok) return parsed.response;

  const manifest = getPluginManifest(id.data);
  if (manifest === undefined) return c.json({ error: 'Plugin not found' }, 404);
  const repoRoot = c.get('repoRoot');
  writePluginSetting(manifest, repoRoot, parsed.data.key, parsed.data.value);
  // Reload so the plugin re-activates and picks up the new value.
  await reloadContentPlugins(repoRoot);
  return c.json({ plugins: describeInstalledPlugins(repoRoot) });
});

pluginsRoutes.post('/plugins/:id/action', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  const parsed = await parseBody(c, RunPluginActionReqSchema);
  if (!parsed.ok) return parsed.response;

  const repoRoot = c.get('repoRoot');
  try {
    await runPluginAction(id.data, parsed.data.actionId);
  } catch (e) {
    // Return the current list + the message so the client (whose apiCall
    // validates the body regardless of status) can show a clean error. The
    // action may still have set config labels before throwing.
    return c.json({ plugins: describeInstalledPlugins(repoRoot), error: e instanceof Error ? e.message : 'Action failed' }, 400);
  }
  // No reload: the plugin ran against its live context; any labels it set are
  // read straight from the override map by describeInstalledPlugins.
  return c.json({ plugins: describeInstalledPlugins(repoRoot) });
});

pluginsRoutes.delete('/plugins/:id', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  const repoRoot = c.get('repoRoot');
  uninstallPlugin(id.data);
  clearConfigLabelOverrides(id.data);
  await reloadContentPlugins(repoRoot);
  return c.json({ plugins: describeInstalledPlugins(repoRoot) });
});
