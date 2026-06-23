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
  --ground-truth <m>  Compare actual images against expected/ground-truth images from a manifest (no git repo required)

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

git difftool integration (see README "Use as git difftool"):
  --register-difftool   Register Glassbox as your git difftool (--global by default; pair with --local for repo-scoped, --force to overwrite an existing tool)
  --unregister-difftool Remove the Glassbox git difftool registration

Examples:
  glassbox --uncommitted
  glassbox --commit abc123
  glassbox --branch main
  glassbox --files "src/**/*.ts,lib/*.js"
  glassbox --all --resume
  glassbox --diff ./before.svg ./after.svg
  glassbox --diff ./dist-old ./dist-new
  glassbox --ground-truth ./screenshots/ground-truth.json
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
  difftoolAction: 'register' | 'unregister' | null;
  difftoolLocal: boolean;
  difftoolForce: boolean;
  difftoolServe: boolean;
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
  let difftoolAction: 'register' | 'unregister' | null = null;
  let difftoolLocal = false;
  let difftoolForce = false;
  let difftoolServe = false;

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
      case "--ground-truth": {
        // Ground-truth comparison (doc 26): a manifest mapping actual images to
        // expected/ground-truth images. The manifest is loaded in main() (file
        // I/O + validation belong there, not in arg parsing); comparisons are
        // filled in then.
        if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
          console.error("--ground-truth requires a manifest path: --ground-truth <manifest.json>");
          process.exit(1);
        }
        mode = { type: "ground-truth", manifestPath: resolve(args[++i]), comparisons: [] };
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
      case "--register-difftool":
        difftoolAction = "register";
        break;
      case "--unregister-difftool":
        difftoolAction = "unregister";
        break;
      case "--difftool-serve":
        // Internal: started detached by the `glassbox-difftool` wrapper to host
        // the accumulating session (doc 19). Not advertised in --help.
        difftoolServe = true;
        break;
      case "--local":
        difftoolLocal = true;
        break;
      case "--force":
        difftoolForce = true;
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

  return { mode, port, dataDir, resume, forceUpdateCheck, debug, aiServiceTest, demo, noOpen, strictPort, projectDir, difftoolAction, difftoolLocal, difftoolForce, difftoolServe };
}

async function main() {
  // `glassbox note ...` — the producer-side review-note writer (docs/20). A
  // standalone subcommand: write the note and exit, without booting the server
  // or touching the review DB.
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === 'note') {
    const { runNoteCli } = await import('./review-notes/cli.js');
    try {
      await runNoteCli(rawArgs.slice(1));
      process.exit(0);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  const parsed = parseArgs(process.argv);
  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { port, resume, forceUpdateCheck, debug, aiServiceTest, demo, noOpen, strictPort, projectDir, difftoolAction, difftoolLocal, difftoolForce, difftoolServe } = parsed;
  // `mode` is reassigned for ground-truth (the manifest is loaded here, not in
  // arg parsing) so the resolved comparisons ride in the mode.
  let { mode, dataDir } = parsed;

  // GB-850 — `--register-difftool` / `--unregister-difftool` are standalone
  // CLI actions: run the git config write and exit, without booting the
  // server or touching the review DB.
  if (difftoolAction !== null) {
    const { registerDifftool, unregisterDifftool, getDifftoolStatus } = await import("./git/difftool.js");
    const scope = difftoolLocal ? 'local' as const : 'global' as const;
    if (difftoolAction === 'register') {
      const res = registerDifftool({ scope, force: difftoolForce });
      if (res.ok) {
        const replaced = res.replacedTool !== null ? ` (replaced previous tool: ${res.replacedTool})` : '';
        console.log(`Glassbox registered as git difftool at --${scope} scope.${replaced}`);
        console.log(`Try it with: git difftool --dir-diff HEAD~1 HEAD`);
        process.exit(0);
      }
      if (res.reason === 'conflict') {
        console.error(`Error: you currently have '${res.currentTool}' set as your git difftool.`);
        console.error(`Pass --force to overwrite it with glassbox, or use --local to register only in this repo.`);
        process.exit(1);
      }
      console.error(`Error: ${res.message}`);
      process.exit(1);
    }
    // unregister
    const status = getDifftoolStatus(scope);
    const res = unregisterDifftool({ scope });
    if (res.removed) {
      console.log(`Glassbox unregistered as git difftool at --${scope} scope.`);
    } else {
      console.log(`Nothing to unregister at --${scope} scope (current tool: ${status.tool ?? 'none'}).`);
    }
    process.exit(0);
  }

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

  // Detached accumulating `git difftool` server (doc 19). Started by the
  // `glassbox-difftool` wrapper; hosts a single review that grows as the
  // wrapper appends files. It deliberately does NOT take the single-instance
  // lock — it coexists with a normal `glassbox` run and manages its own
  // lifetime via the session hold + discovery lockfile.
  if (difftoolServe) {
    const { initDifftoolSession } = await import("./difftool/session.js");
    const { writeDiscovery, clearDiscovery, releaseStartingLock } = await import("./git/difftool-discovery.js");
    const { clearImageBlobs } = await import("./git/image-blobs.js");
    mkdirSync(dataDir, { recursive: true });
    setDataDir(dataDir);
    // Capture as a const so the shutdown closure below sees a non-null string
    // (TS won't narrow the captured `let dataDir`).
    const sessionDataDir = dataDir;
    // Clear any image blobs left by a previous session that was hard-killed
    // (e.g. desktop window force-close) before it could run teardown (GB-863).
    clearImageBlobs(sessionDataDir);
    const repoRoot = process.cwd();
    const review = await createReview(repoRoot, "git difftool", "difftool");
    const { port: actualPort, server } = await startServer(port, review.id, repoRoot, { noOpen, strictPort });
    initDifftoolSession({
      reviewId: review.id,
      repoRoot,
      shutdown: () => {
        try { server.close(); } catch { /* already closing */ }
        clearImageBlobs(sessionDataDir);
        clearDiscovery();
        releaseStartingLock();
        process.exit(0);
      },
    });
    // Record the port for the wrapper's discover-or-start loop, then release the
    // start election so waiting invocations append instead of starting another.
    writeDiscovery(actualPort);
    releaseStartingLock();
    return;
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
  // Ground-truth (doc 26 P2): perceptual difference score per comparison key,
  // computed at launch and stored on each review file. Empty for other modes.
  const groundTruthScores = new Map<string, number | null>();

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
  } else if (mode.type === "ground-truth") {
    // Ground-truth (doc 26): load + validate the manifest, resolve each
    // actual/expected pair, and confirm the images exist. Like --diff, this
    // needs no git repository.
    const { loadGroundTruthManifest } = await import("./ground-truth/manifest.js");
    let comparisons;
    try {
      comparisons = loadGroundTruthManifest(mode.manifestPath);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    for (const entry of comparisons) {
      for (const [role, p] of [["actual", entry.actualPath], ["expected", entry.expectedPath]] as const) {
        if (!existsSync(p)) {
          console.error(`Error: ${role} image does not exist: ${p}`);
          process.exit(1);
        }
      }
    }
    // Perceptual diff (doc 26 P2): score each pair so the review can be triaged
    // and identical pairs hidden. Scores are stored per file at creation below.
    const { comparePerceptual } = await import("./ground-truth/perceptual-diff.js");
    let identical = 0;
    let undecodable = 0;
    for (const entry of comparisons) {
      const result = comparePerceptual(entry.actualPath, entry.expectedPath);
      groundTruthScores.set(entry.key, result.score);
      if (result.reason === "undecodable") undecodable++;
      else if (result.score === 0) identical++;
    }
    if (identical > 0 || undecodable > 0) {
      const parts: string[] = [];
      if (identical > 0) parts.push(`${identical} identical (hidden by default)`);
      if (undecodable > 0) parts.push(`${undecodable} not scored (unsupported format)`);
      console.log(`Perceptual diff: ${parts.join(", ")}.`);
    }
    mode = { ...mode, comparisons };
    repoRoot = cwd;
    repoName = `Ground truth: ${basename(mode.manifestPath)}`;
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

  // Add files (with the ground-truth perceptual score when present, doc 26 P2)
  for (const diff of diffs) {
    await addReviewFile(review.id, diff.filePath, JSON.stringify(diff), groundTruthScores.get(diff.filePath) ?? null);
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
