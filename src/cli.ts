import { existsSync, mkdirSync, realpathSync, statSync } from "fs";
import { tmpdir } from "os";
import { basename, join, resolve } from "path";

import { setDataDir } from "./db/connection.js";
import { addReviewFile, createReview, getLatestInProgressReview } from "./db/queries.js";
import { setAIServiceTest, setDebug, setDemoMode } from "./debug.js";
import { DEMO_SCENARIOS, setupDemoReview } from "./demo.js";
import type { ReviewMode } from "./git/diff.js";
import { getFileDiffs, getHeadCommit, getModeArgs, getModeString, getRepoName, getRepoRoot, isGitRepo } from "./git/diff.js";
import { acquireLock } from "./lock.js";
import { updateReviewDiffs } from "./review-update.js";
import { startServer } from "./server.js";
import { ensureSkills } from "./skills.js";
import { checkForUpdates } from "./update-check.js";

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
  --diff <a> <b>      Compare two arbitrary files or folders by path (no git repo required)

Options:
  --port <number>     Port to run on (default: 4183)
  --data-dir <path>   Store data in an alternative location (default: .glassbox/)
  --resume            Resume the latest in-progress review for this mode
  --no-open           Don't open browser automatically
  --strict-port       Fail if the requested port is in use
  --project-dir <dir> Run as if invoked from <dir> (used by Tauri desktop app)
  --check-for-updates Check for a newer version on npm
  --ai-service-test   Use mock AI responses (no API calls, no tokens used)
  --help              Show this help message

Examples:
  glassbox --uncommitted
  glassbox --commit abc123
  glassbox --branch main
  glassbox --files "src/**/*.ts,lib/*.js"
  glassbox --all --resume
  glassbox --diff ./before.svg ./after.svg
  glassbox --diff ./dist-old ./dist-new
`);
}

export function parseArgs(
  argv: string[],
): {
  mode: ReviewMode;
  port: number;
  dataDir: string | null;
  resume: boolean;
  forceUpdateCheck: boolean;
  debug: boolean;
  aiServiceTest: boolean;
  demo: number | null;
  noOpen: boolean;
  strictPort: boolean;
  projectDir: string | null;
} | null {
  const args = argv.slice(2);
  let mode: ReviewMode | null = null;
  let port = 4183;
  let dataDir: string | null = null;
  let resume = false;
  let forceUpdateCheck = false;
  let debug = false;
  let aiServiceTest = false;
  let demo: number | null = null;
  let noOpen = false;
  let strictPort = false;
  let projectDir: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      // falls through
      case "--uncommitted":
        mode = { type: "uncommitted" };
        break;
      case "--staged":
        mode = { type: "staged" };
        break;
      case "--unstaged":
        mode = { type: "unstaged" };
        break;
      case "--commit":
        mode = { type: "commit", sha: args[++i] };
        break;
      case "--range": {
        const parts = args[++i].split("..");
        mode = { type: "range", from: parts[0], to: parts[1] || "HEAD" };
        break;
      }
      case "--branch":
        mode = { type: "branch", name: args[++i] };
        break;
      case "--files":
        mode = { type: "files", patterns: args[++i].split(",") };
        break;
      case "--all":
        mode = { type: "all" };
        break;
      case "--diff": {
        // Catch the common slip of forgetting one path: if either slot is
        // missing or looks like a flag, fail with a clear message instead of
        // resolving "--foo" into a non-existent path.
        if (i + 2 >= args.length || args[i + 1].startsWith("-") || args[i + 2].startsWith("-")) {
          console.error("--diff requires two paths: --diff <pathA> <pathB>");
          process.exit(1);
        }
        // Store absolute paths so the mode is stable regardless of later cwd.
        mode = { type: "diff", pathA: resolve(args[++i]), pathB: resolve(args[++i]) };
        break;
      }
      case "--port":
        port = parseInt(args[++i], 10);
        break;
      case "--data-dir":
        dataDir = resolve(args[++i]);
        break;
      case "--resume":
        resume = true;
        break;
      case "--check-for-updates":
        forceUpdateCheck = true;
        break;
      case "--debug":
        debug = true;
        break;
      case "--ai-service-test":
        aiServiceTest = true;
        break;
      case "--no-open":
        noOpen = true;
        break;
      case "--strict-port":
        strictPort = true;
        break;
      case "--project-dir":
        projectDir = args[++i];
        break;
      default:
        if (arg.startsWith("--demo:")) {
          demo = parseInt(arg.slice(7), 10);
          if (isNaN(demo) || demo < 1) {
            console.error(`Invalid demo scenario: ${arg}`);
            process.exit(1);
          }
          break;
        }
        console.error(`Unknown option: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!mode) {
    mode = { type: "uncommitted" };
  }

  return { mode, port, dataDir, resume, forceUpdateCheck, debug, aiServiceTest, demo, noOpen, strictPort, projectDir };
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { mode, port, resume, forceUpdateCheck, debug, aiServiceTest, demo, noOpen, strictPort, projectDir } = parsed;
  let { dataDir } = parsed;

  setDebug(debug);
  setAIServiceTest(aiServiceTest);
  if (aiServiceTest) {
    console.log("AI service test mode enabled — using mock AI responses");
  }
  if (debug) {
    console.log(`[debug] Build timestamp: ${process.env.BUILD_TIMESTAMP}`);
  }

  // Change working directory if --project-dir was passed (used by Tauri desktop app)
  if (projectDir !== null) {
    process.chdir(projectDir);
  }

  // Resolve data directory default after any chdir
  if (dataDir === null) {
    dataDir = join(process.cwd(), '.glassbox');
  }

  // Demo mode: use a fresh temp directory
  if (demo !== null) {
    const scenario = DEMO_SCENARIOS.find((s) => s.id === demo);
    if (scenario === undefined) {
      console.error(`Unknown demo scenario: ${String(demo)}`);
      console.error("Available scenarios:");
      for (const s of DEMO_SCENARIOS) {
        console.error(`  --demo:${String(s.id)}  ${s.label}`);
      }
      process.exit(1);
    }
    dataDir = join(tmpdir(), `glassbox-demo-${demo}-${Date.now()}`);
    setDemoMode(demo);
    console.log(`\n  DEMO MODE: ${scenario.label}\n`);
  }

  // Ensure data directory exists
  mkdirSync(dataDir, { recursive: true });

  // Acquire instance lock (skip for demo mode — allow multiple demos)
  if (demo === null) {
    acquireLock(dataDir);
  }

  // Initialize database
  setDataDir(dataDir);

  if (demo !== null) {
    const { reviewId } = await setupDemoReview(demo);
    await startServer(port, reviewId, process.cwd(), { noOpen, strictPort });
    return;
  }

  // Check for updates (once per day, or if --check-for-updates is passed)
  await checkForUpdates(forceUpdateCheck);

  const cwd = process.cwd();

  // Generate AI tool skills (/glassbox) for supported platforms
  const skillPlatforms = ensureSkills();
  if (skillPlatforms.length > 0) {
    console.log(`AI tool skills created/updated for: ${skillPlatforms.join(', ')}`);
  }

  // Direct comparison (doc 18) works on two arbitrary paths and does not need a
  // git repository. All other modes require running inside one.
  let repoRoot: string;
  let repoName: string;
  let headCommit = "";

  if (mode.type === "diff") {
    const { pathA, pathB } = mode;
    for (const p of [pathA, pathB]) {
      if (!existsSync(p)) {
        console.error(`Error: path does not exist: ${p}`);
        process.exit(1);
      }
    }
    if (statSync(pathA).isDirectory() !== statSync(pathB).isDirectory()) {
      console.error("Error: --diff requires two files or two folders, not a mix of both.");
      process.exit(1);
    }
    // No repo: anchor data/export at the working directory, label by basenames.
    repoRoot = cwd;
    repoName = `${basename(pathA)} ↔ ${basename(pathB)}`;
  } else {
    if (!isGitRepo(cwd)) {
      console.error("Error: Not a git repository. Run this from inside a git repo.");
      process.exit(1);
    }
    repoRoot = getRepoRoot(cwd);
    repoName = getRepoName(cwd);
    headCommit = getHeadCommit(cwd);
  }

  const modeStr = getModeString(mode);
  const modeArgs = getModeArgs(mode);

  // Check for existing in-progress review
  const existing = await getLatestInProgressReview(repoRoot, modeStr, modeArgs);

  if (existing) {
    // Same HEAD — reuse review and update diffs
    if (existing.head_commit === headCommit) {
      console.log(`Updating existing review ${existing.id}...`);
      const diffs = getFileDiffs(mode, cwd);
      const result = await updateReviewDiffs(existing.id, diffs, headCommit);
      console.log(`Updated ${result.updated} file(s), ${result.added} added, ${result.stale} stale annotation(s)`);
      await startServer(port, existing.id, repoRoot, { noOpen, strictPort });
      return;
    }

    // Different HEAD but --resume: reopen as-is
    if (resume) {
      console.log(`Resuming review ${existing.id} (started ${existing.created_at})`);
      await startServer(port, existing.id, repoRoot, { noOpen, strictPort });
      return;
    }
  } else if (resume) {
    console.log("No in-progress review found, starting a new one.");
  }

  // Get diffs
  console.log(`Scanning ${modeStr} changes in ${repoName}...`);
  const diffs = getFileDiffs(mode, cwd);

  if (diffs.length === 0) {
    console.log("No changes found for the specified mode.");
    process.exit(0);
  }

  console.log(`Found ${diffs.length} file(s) to review.`);

  // Create review
  const review = await createReview(repoRoot, repoName, modeStr, modeArgs, headCommit);

  // Add files
  for (const diff of diffs) {
    await addReviewFile(review.id, diff.filePath, JSON.stringify(diff));
  }

  console.log(`Review ${review.id} created.`);

  await startServer(port, review.id, repoRoot, { noOpen, strictPort });
}

// Only run main() when executed as entry point (not when imported for testing).
// Resolve symlinks (e.g. npm global bin symlink) before checking the filename.
const resolvedArg = process.argv[1] ? realpathSync(process.argv[1]) : '';
const isDirectRun = resolvedArg.endsWith('cli.js') || resolvedArg.endsWith('cli.ts');
if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
