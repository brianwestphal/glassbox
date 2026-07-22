/**
 * Compare two dotted version strings numerically, segment by segment.
 * Returns -1 / 0 / 1 (a before b / equal / a after b). Non-numeric segments count as 0;
 * missing segments count as 0 (so "1.2" == "1.2.0"). The single shared
 * comparator — previously hand-rolled three ways in update-check, the plugin
 * installer, and the channel-api minimum-version check.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
