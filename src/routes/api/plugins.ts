/**
 * Content-plugin management API (doc 29, GB-1040): list installed plugins with
 * their state, toggle enablement (global / per-project), install from a
 * directory, and uninstall. Every mutation reloads the subsystem so the change
 * takes effect immediately, and returns the refreshed list.
 */
import { Hono } from 'hono';

import { InstallPluginReqSchema, SetPluginDisabledReqSchema } from '../../api/plugins.js';
import { setGlobalDisabled, setProjectDisabled } from '../../plugins/enablement.js';
import { describeInstalledPlugins, reloadContentPlugins } from '../../plugins/index.js';
import { installPluginFromDisk, uninstallPlugin } from '../../plugins/install.js';
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
    return c.json({ error: e instanceof Error ? e.message : 'install failed' }, 400);
  }
  await reloadContentPlugins(repoRoot);
  return c.json({ plugins: describeInstalledPlugins(repoRoot) });
});

pluginsRoutes.delete('/plugins/:id', async (c) => {
  const id = requirePathParam(c, 'id');
  if (!id.ok) return id.response;
  const repoRoot = c.get('repoRoot');
  uninstallPlugin(id.data);
  await reloadContentPlugins(repoRoot);
  return c.json({ plugins: describeInstalledPlugins(repoRoot) });
});
