import { describe, expect, it } from 'vitest';

import type { PluginRequirement } from '../../../src/plugins/manifest.js';
import { checkRequirement, checkRequirements, type CommandProbe, requirementMet } from '../../../src/plugins/readiness.js';

// doc 29 §29.2 (GB-1069) — plugin system-readiness checks.
describe('plugin readiness checks', () => {
  const java: PluginRequirement = { id: 'java', label: 'Java', command: 'java', checkArgs: ['-version'], hint: 'install a JRE' };
  const npm: PluginRequirement = { id: 'npm', label: 'npm', command: 'npm', hint: 'install node' };

  it('reports a requirement as met when the probe succeeds', () => {
    const probe: CommandProbe = () => true;
    const s = checkRequirement(java, probe);
    expect(s).toEqual({ id: 'java', label: 'Java', met: true, hint: 'install a JRE', docUrl: undefined });
  });

  it('reports unmet + carries the remediation hint when the probe fails', () => {
    const s = checkRequirement(java, () => false);
    expect(s.met).toBe(false);
    expect(s.hint).toBe('install a JRE');
  });

  it('passes the declared command + checkArgs to the probe (default --version)', () => {
    const calls: [string, string[]][] = [];
    const probe: CommandProbe = (cmd, args) => { calls.push([cmd, args]); return true; };
    checkRequirement(java, probe);
    checkRequirement(npm, probe);
    expect(calls).toEqual([['java', ['-version']], ['npm', ['--version']]]);
  });

  it('checkRequirements maps every requirement; empty/undefined → []', () => {
    const probe: CommandProbe = (cmd) => cmd === 'java'; // java present, npm not
    const out = checkRequirements([java, npm], probe);
    expect(out.map((s) => [s.id, s.met])).toEqual([['java', true], ['npm', false]]);
    expect(checkRequirements(undefined, probe)).toEqual([]);
    expect(checkRequirements([], probe)).toEqual([]);
  });

  it('requirementMet finds a satisfied requirement by id (missing id → false)', () => {
    const statuses = checkRequirements([java, npm], (cmd) => cmd === 'java');
    expect(requirementMet(statuses, 'java')).toBe(true);
    expect(requirementMet(statuses, 'npm')).toBe(false);
    expect(requirementMet(statuses, 'nope')).toBe(false);
  });
});
