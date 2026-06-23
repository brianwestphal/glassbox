// Stored review modes use the raw form produced by `getModeString()`:
//   uncommitted | staged | unstaged | all
//   commit:<sha>
//   range:<from>..<to>
//   branch:<name>
//   files:<pattern>[,<pattern>...]
// and `mode_args` is the trailing portion after the colon (or null for the
// no-arg variants). The sidebar used to render `mode + ": " + mode_args`
// which double-printed the SHA (`commit:abc…: abc…`) and never shortened it,
// so a 40-char hash wrapped to two lines. This formatter returns one clean,
// short, single-source label per mode.

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

function shortenIfSha(ref: string): string {
  if (FULL_SHA_RE.test(ref)) return ref.slice(0, 7);
  return ref;
}

// Returns the args payload for a prefixed mode, preferring the explicit
// `modeArgs` column and falling back to the part of the mode string after
// the prefix. Accepts both the production form (`commit:SHA`) and the bare
// form (`commit` with args in modeArgs) defensively.
function argsFor(mode: string, prefix: string, modeArgs: string | null): string {
  if (modeArgs !== null && modeArgs !== '') return modeArgs;
  if (mode.startsWith(prefix)) return mode.slice(prefix.length);
  return '';
}

export function formatReviewMode(mode: string, modeArgs: string | null): string {
  if (mode === 'commit' || mode.startsWith('commit:')) {
    return `commit: ${shortenIfSha(argsFor(mode, 'commit:', modeArgs))}`;
  }
  if (mode === 'range' || mode.startsWith('range:')) {
    const raw = argsFor(mode, 'range:', modeArgs);
    const [from = '', to = ''] = raw.split('..');
    return `range: ${shortenIfSha(from)}..${shortenIfSha(to)}`;
  }
  if (mode === 'branch' || mode.startsWith('branch:')) {
    return `branch: ${argsFor(mode, 'branch:', modeArgs)}`;
  }
  if (mode === 'files' || mode.startsWith('files:')) {
    return `files: ${argsFor(mode, 'files:', modeArgs)}`;
  }
  if (mode === 'diff' || mode.startsWith('diff:')) {
    // Direct comparison (doc 18). The mode string is `diff:[pathA,pathB]` JSON;
    // prefer the short `mode_args` label, falling back to path basenames.
    if (modeArgs !== null && modeArgs !== '') return `compare: ${modeArgs}`;
    if (mode.startsWith('diff:')) {
      try {
        const parsed: unknown = JSON.parse(mode.slice(5));
        if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
          const baseA = parsed[0].split('/').pop() ?? parsed[0];
          const baseB = parsed[1].split('/').pop() ?? parsed[1];
          return `compare: ${baseA} ↔ ${baseB}`;
        }
      } catch { /* fall through */ }
    }
    return 'compare';
  }
  if (mode === 'ground-truth' || mode.startsWith('ground-truth:')) {
    // Ground-truth (doc 26). The mode string is `ground-truth:{manifestPath,
    // comparisons}` JSON — the comparisons array can be huge, so never render it
    // raw (GB-971). Show a short "ground truth: <manifest basename>" label.
    if (modeArgs !== null && modeArgs !== '') return `ground truth: ${modeArgs}`;
    if (mode.startsWith('ground-truth:')) {
      try {
        const parsed: unknown = JSON.parse(mode.slice('ground-truth:'.length));
        if (parsed !== null && typeof parsed === 'object' && 'manifestPath' in parsed) {
          const manifestPath: unknown = parsed.manifestPath;
          if (typeof manifestPath === 'string' && manifestPath !== '') {
            return `ground truth: ${manifestPath.split('/').pop() ?? manifestPath}`;
          }
        }
      } catch { /* fall through */ }
    }
    return 'ground truth';
  }
  return mode;
}
