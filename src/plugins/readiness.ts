/**
 * System-readiness checks for opt-in plugin install (doc 29 §29.2, GB-1069).
 * Given a plugin's manifest `requirements` (e.g. a JRE for PlantUML, `npm` for
 * Mermaid), probe whether each is present by running its `command <checkArgs>`.
 *
 * A requirement is something the host can't install for the user — it can only
 * detect it and, when missing, surface the manifest's remediation `hint`. The
 * probe is injectable (`runProbe`) so it's unit-testable without spawning real
 * processes.
 */
import { spawnSync } from 'child_process';

import type { PluginRequirement } from './manifest.js';

/** One requirement's readiness, with the remediation text to show when unmet. */
export interface RequirementStatus {
  id: string;
  label: string;
  met: boolean;
  /** Shown when `met` is false — how to satisfy it. */
  hint: string;
  docUrl?: string;
}

/** Probes whether a command is runnable; returns true if present + exits cleanly. */
export type CommandProbe = (command: string, args: string[]) => boolean;

/** The default probe: run `command args` and treat a clean exit as "present". */
const defaultProbe: CommandProbe = (command, args) => {
  try {
    const r = spawnSync(command, args, { stdio: 'ignore', timeout: 10_000 });
    // ENOENT / EACCES / timeout → `error` set → not present. Otherwise a 0 exit
    // (the `--version` convention) means the tool ran.
    return r.error === undefined && r.status === 0;
  } catch {
    return false;
  }
};

/** Check one requirement's readiness. */
export function checkRequirement(req: PluginRequirement, runProbe: CommandProbe = defaultProbe): RequirementStatus {
  const met = runProbe(req.command, req.checkArgs ?? ['--version']);
  return { id: req.id, label: req.label, met, hint: req.hint, docUrl: req.docUrl };
}

/** Check every requirement; an empty list is trivially all-met. */
export function checkRequirements(reqs: PluginRequirement[] | undefined, runProbe: CommandProbe = defaultProbe): RequirementStatus[] {
  return (reqs ?? []).map((r) => checkRequirement(r, runProbe));
}

/** Whether a requirement with `id` is satisfied in a checked set (missing id → false). */
export function requirementMet(statuses: RequirementStatus[], id: string): boolean {
  return statuses.find((s) => s.id === id)?.met ?? false;
}
