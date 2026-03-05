import { startServer } from './server.js';
import { isGitRepo, getRepoRoot, getRepoName, getFileDiffs, getModeString, getModeArgs } from './git/diff.js';
import type { ReviewMode } from './git/diff.js';
import { createReview, getLatestInProgressReview, addReviewFile } from './db/queries.js';
import { checkForUpdates } from './update-check.js';

function printUsage() {
  console.log(`
glassbox - Review AI-generated code with annotations

Usage:
  glassbox [options]

Modes (pick one):
  --uncommitted       Review all uncommitted changes (staged + unstaged + untracked)
  --staged            Review only staged changes
  --unstaged          Review only unstaged changes
  --commit <sha>      Review changes from a specific commit
  --range <from>..<to>  Review changes between two refs
  --branch <name>     Review changes on current branch vs <name>
  --files <patterns>  Review specific files (glob patterns, comma-separated)
  --all               Review entire codebase

Options:
  --port <number>     Port to run on (default: 4173)
  --resume            Resume the latest in-progress review for this mode
  --check-for-updates Check for a newer version on npm
  --help              Show this help message

Examples:
  glassbox --uncommitted
  glassbox --commit abc123
  glassbox --branch main
  glassbox --files "src/**/*.ts,lib/*.js"
  glassbox --all --resume
`);
}

function parseArgs(argv: string[]): { mode: ReviewMode; port: number; resume: boolean; forceUpdateCheck: boolean } | null {
  const args = argv.slice(2);
  let mode: ReviewMode | null = null;
  let port = 4173;
  let resume = false;
  let forceUpdateCheck = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      case '--uncommitted':
        mode = { type: 'uncommitted' };
        break;
      case '--staged':
        mode = { type: 'staged' };
        break;
      case '--unstaged':
        mode = { type: 'unstaged' };
        break;
      case '--commit':
        mode = { type: 'commit', sha: args[++i] };
        break;
      case '--range': {
        const parts = args[++i].split('..');
        mode = { type: 'range', from: parts[0], to: parts[1] || 'HEAD' };
        break;
      }
      case '--branch':
        mode = { type: 'branch', name: args[++i] };
        break;
      case '--files':
        mode = { type: 'files', patterns: args[++i].split(',') };
        break;
      case '--all':
        mode = { type: 'all' };
        break;
      case '--port':
        port = parseInt(args[++i], 10);
        break;
      case '--resume':
        resume = true;
        break;
      case '--check-for-updates':
        forceUpdateCheck = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!mode) {
    return null;
  }

  return { mode, port, resume, forceUpdateCheck };
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { mode, port, resume, forceUpdateCheck } = parsed;

  // Check for updates (once per day, or if --check-for-updates is passed)
  await checkForUpdates(forceUpdateCheck);

  const cwd = process.cwd();

  if (!isGitRepo(cwd)) {
    console.error('Error: Not a git repository. Run this from inside a git repo.');
    process.exit(1);
  }

  const repoRoot = getRepoRoot(cwd);
  const repoName = getRepoName(cwd);
  const modeStr = getModeString(mode);
  const modeArgs = getModeArgs(mode);

  // Check for existing in-progress review
  if (resume) {
    const existing = await getLatestInProgressReview(repoRoot, modeStr, modeArgs);
    if (existing) {
      console.log(`Resuming review ${existing.id} (started ${existing.created_at})`);
      await startServer(port, existing.id, repoRoot);
      return;
    }
    console.log('No in-progress review found, starting a new one.');
  }

  // Get diffs
  console.log(`Scanning ${modeStr} changes in ${repoName}...`);
  const diffs = getFileDiffs(mode, cwd);

  if (diffs.length === 0) {
    console.log('No changes found for the specified mode.');
    process.exit(0);
  }

  console.log(`Found ${diffs.length} file(s) to review.`);

  // Create review
  const review = await createReview(repoRoot, repoName, modeStr, modeArgs);

  // Add files
  for (const diff of diffs) {
    await addReviewFile(review.id, diff.filePath, JSON.stringify(diff));
  }

  console.log(`Review ${review.id} created.`);

  await startServer(port, review.id, repoRoot);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
