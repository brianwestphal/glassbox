/**
 * Typed API for `.glassbox/settings.json` (per-repo project settings).
 */
import { z } from 'zod';

import { apiCall } from './_runner.js';

export const ProjectSettingsSchema = z.object({
  appName: z.string().optional(),
  /** Content-plugin ids disabled for THIS project (doc 29 FR-29.16). A plugin is
   *  enabled unless it appears here or in the global disabled list. */
  disabledPlugins: z.array(z.string()).optional(),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const GetProjectSettingsRespSchema = ProjectSettingsSchema;
export type GetProjectSettingsResp = z.infer<typeof GetProjectSettingsRespSchema>;

export const UpdateProjectSettingsReqSchema = ProjectSettingsSchema.partial();
export type UpdateProjectSettingsReq = z.infer<typeof UpdateProjectSettingsReqSchema>;

export const UpdateProjectSettingsRespSchema = ProjectSettingsSchema;
export type UpdateProjectSettingsResp = z.infer<typeof UpdateProjectSettingsRespSchema>;

export async function getProjectSettings(): Promise<GetProjectSettingsResp> {
  return apiCall(GetProjectSettingsRespSchema, '/project-settings');
}

export async function updateProjectSettings(req: UpdateProjectSettingsReq): Promise<UpdateProjectSettingsResp> {
  return apiCall(UpdateProjectSettingsRespSchema, '/project-settings', { method: 'PATCH', body: req });
}
