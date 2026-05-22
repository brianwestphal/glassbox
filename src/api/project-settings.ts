/**
 * Typed API for `.glassbox/settings.json` (per-repo project settings).
 */
import { api } from './_runner.js';

export interface ProjectSettings {
  appName?: string;
}

export type GetProjectSettingsResp = ProjectSettings;

export type UpdateProjectSettingsReq = Partial<ProjectSettings>;
export type UpdateProjectSettingsResp = ProjectSettings;

export async function getProjectSettings(): Promise<GetProjectSettingsResp> {
  return api<GetProjectSettingsResp>('/project-settings');
}

export async function updateProjectSettings(req: UpdateProjectSettingsReq): Promise<UpdateProjectSettingsResp> {
  return api<UpdateProjectSettingsResp>('/project-settings', { method: 'PATCH', body: req });
}
