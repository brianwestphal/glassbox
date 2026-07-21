import { existsSync, mkdirSync, realpathSync, statSync } from "fs";
import { tmpdir } from "os";
import { basename, join, resolve } from "path";

import { handleDifftoolRegistration, handleGroundTruthPromote, handleNoteSubcommand } from "./cli-subcommands.js";
import { setDataDir } from "./db/connection.js";
import { addReviewFile, createReview, getLatestInProgressReview } from "./db/queries.js";
import { setAIServiceTest, setDebug, setDemoMode } from "./debug.js";
import { DEMO_SCENARIOS, setupDemoReview } from "./demo.js";
import type { ReviewMode } from "./git/diff.js";
import { getFileDiffs, getHeadCommit, getModeArgs, getModeString, getRepoName, getRepoRoot, isGitRepo } from "./git/diff.js";
import { ensureGlassboxGitignored } from "./git/gitignore.js";
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

Subcommands:
  ground-truth promote <m>  Copy a manifest's current actuals over their previous-actual baselines (rotate baselines for next-run regression)

Options:
  --port <number>     Port to run on (default: 4183)
  --data-dir <path>   Store data in an alternative location (default: .glassbox/)
  --resume            Resume the latest in-progress review for this mode
  --no-open           Don't open browser automatically
  --strict-port       Fail if the requested port is in use
  --project-dir <dir> Run as if invoked from <dir> (used by Tauri desktop app)
  --on-complete <cmd> Run <cmd> when a review is completed (local command; receives the export paths via GLASSBOX_REVIEW_JSON/_MD/_ID env vars)
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
  onComplete: string | null;
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
  let onComplete: string | null = null;
  let difftoolAction: 'register' | 'unregister' | null = null;
  let difftoolLocal = false;
  let difftoolForce = false;
  let difftoolServe = false;

  // Consume and return the value following a value-taking flag, failing with a
  // clean message (instead of an undefined-deref stack trace) when it's missing.
  // By default a value that looks like another flag (`-`-prefixed) is rejected
  // as a likely "forgot the value" slip; pass `allowDash` for flags whose value
  // can legitimately start with `-` (e.g. an `--on-complete` command).
  let i = 0;
  const requireValue = (flag: string, allowDash = false): string => {
    i++;
    if (i >= args.length || (!allowDash && args[i].startsWith("-"))) {
      console.error(`${flag} requires a value`);
      process.exit(1);
    }
    return args[i];
  };

  for (; i < args.length; i++) {
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
        mode = { type: "commit", sha: requireValue("--commit") };
        break;
      case "--range": {
        const parts = requireValue("--range").split("..");
        mode = { type: "range", from: parts[0], to: parts[1] || "HEAD" };
        break;
      }
      case "--branch":
        mode = { type: "branch", name: requireValue("--branch") };
        break;
      case "--files":
        mode = { type: "files", patterns: requireValue("--files").split(",") };
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
      case "--port": {
        const raw = requireValue("--port");
        const parsedPort = parseInt(raw, 10);
        if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
          console.error(`--port must be an integer between 1 and 65535 (got "${raw}")`);
          process.exit(1);
        }
        port = parsedPort;
        break;
      }
      case "--data-dir":
        dataDir = resolve(requireValue("--data-dir"));
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
        projectDir = requireValue("--project-dir");
        break;
      case "--on-complete":
        // A command run when a review is explicitly completed (doc 2 / GB-974).
        // Local, user-supplied; never taken from network input. The command may
        // legitimately start with `-`, so dash-prefixed values are allowed.
        onComplete = requireValue("--on-complete", true);
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

  return { mode, port, dataDir, resume, forceUpdateCheck, debug, aiServiceTest, demo, noOpen, strictPort, projectDir, onComplete, difftoolAction, difftoolLocal, difftoolForce, difftoolServe };
}

async function main() {
  // Standalone subcommands (doc 20 / doc 26 / doc 19) handle their work and exit
  // without booting the server or touching the review DB — see cli-subcommands.ts.
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === 'note') {
    await handleNoteSubcommand(rawArgs.slice(1));
  }
  if (rawArgs[0] === 'ground-truth' && rawArgs[1] === 'promote') {
    await handleGroundTruthPromote(rawArgs[2]);
  }

  const parsed = parseArgs(process.argv);
  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { port, resume, forceUpdateCheck, debug, aiServiceTest, demo, noOpen, strictPort, projectDir, onComplete, difftoolAction, difftoolLocal, difftoolForce, difftoolServe } = parsed;
  // `mode` is reassigned for ground-truth (the manifest is loaded here, not in
  // arg parsing) so the resolved comparisons ride in the mode.
  let { mode, dataDir } = parsed;

  // GB-850 — `--register-difftool` / `--unregister-difftool` are standalone CLI
  // actions: run the git config write and exit (see cli-subcommands.ts).
  if (difftoolAction !== null) {
    await handleDifftoolRegistration(difftoolAction, difftoolLocal, difftoolForce);
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
    if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
      console.error(`--project-dir is not a directory: ${projectDir}`);
      process.exit(1);
    }
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
    // A difftool session also writes `.glassbox/` into the repo — keep it
    // gitignored automatically (doc 27).
    ensureGlassboxGitignored(dataDir);
    // Capture as a const so the shutdown closure below sees a non-null string
    // (TS won't narrow the captured `let dataDir`).
    const sessionDataDir = dataDir;
    // Clear any image blobs left by a previous session that was hard-killed
    // (e.g. desktop window force-close) before it could run teardown (GB-863).
    clearImageBlobs(sessionDataDir);
    const repoRoot = process.cwd();
    const review = await createReview(repoRoot, "git difftool", "difftool");
    const { port: actualPort, server } = await startServer(port, review.id, repoRoot, { noOpen, strictPort, onComplete });
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
    await startServer(port, reviewId, process.cwd(), { noOpen, strictPort, onComplete });
    return;
  }

  // Keep `.glassbox/` out of version control automatically (doc 27), while
  // leaving the per-project `settings.json` tracked. No-ops outside a git repo
  // and when the user has opted out via a commented rule.
  const gitignore = ensureGlassboxGitignored(dataDir);
  if (gitignore.changed) console.log("Updated .gitignore to exclude .glassbox/ (keeping settings.json tracked).");

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
    // Load content plugins first so an installed image-decoder plugin (doc 29
    // imageDecoders) can score formats core can't decode (WebP/AVIF). Idempotent:
    // the later startServer() init is a no-op.
    const { initContentPlugins } = await import("./plugins/index.js");
    await initContentPlugins(cwd);
    const { comparePerceptual } = await import("./ground-truth/perceptual-diff.js");
    let identical = 0;
    let undecodable = 0;
    for (const entry of comparisons) {
      const result = await comparePerceptual(entry.actualPath, entry.expectedPath);
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
      await startServer(port, existing.id, repoRoot, { noOpen, strictPort, onComplete });
      return;
    }

    // Different HEAD but --resume: reopen as-is
    if (resume) {
      console.log(`Resuming review ${existing.id} (started ${existing.created_at})`);
      await startServer(port, existing.id, repoRoot, { noOpen, strictPort, onComplete });
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

  await startServer(port, review.id, repoRoot, { noOpen, strictPort, onComplete });
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
