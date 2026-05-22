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
  return mode;
}
