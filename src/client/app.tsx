import {
  getAIConfig,
  getAIPreferences,
  getCurrentReview,
  refreshReview,
  SortModeSchema,
  SvgViewModeSchema,
  SxsOrientationSchema,
} from "../api/index.js";
import { IconGear, IconRefresh } from "../icons.js";
import { initDebug } from "./api.js";
import { parseDeepLink } from "./diff/deepLink.js";
import { bindFind } from "./diff/find.js";
import { bindGoToDefinition, navigateToLocation } from "./diff/goToDefinition.js";
import { initDiffView, invalidateDiffCache, setRawDiffContent, updateNavFilePath } from "./diff/index.js";
import { getVisibleScrollLine, navBack, navForward, navUpdateScroll, setNavigating } from "./diff/navStack.js";
import { selectFile } from "./diff/selection.js";
import { bindToolbar } from "./diff/toolbar.js";
import { initDifftoolSession } from "./difftool/session.js";
import { toElement } from "./dom.js";
import { triggerGuidedAnalysis } from "./guided.js";
import { initPluginUi } from "./plugins/uiExtensions.js";
import { bindCompleteButton, bindReopenButton } from "./review/modal.js";
import { initProgress } from "./review/progress.js";
import { initSharePrompt } from "./share.js";
import { loadFiles } from "./sidebar/fileTree.js";
import { initSidebar } from "./sidebar/index.js";
import { loadAnalysisResults, triggerAnalysis } from "./sidebar/sortMode.js";
import { aiStore, diffViewStore, dragStore, reviewStore, visibleFileOrder } from "./stores/index.js";
// --- Tauri update notification ---
import { getTauriInvoke, showUpdateBanner } from "./tauri.js";
import { SCROLL_SAVE_DEBOUNCE_MS, UPDATE_POLL_DELAYS_MS } from './timing.js';

async function initAISorting() {
  try {
    // Load user preferences
    const prefs = await getAIPreferences();
    // Re-validate each enum-typed pref. The server's response schema
    // permits any string for forward-compat (an older config row may
    // hold a value we don't recognize), so we narrow back to the
    // expected enum and fall back to the default on mismatch.
    const sortMode = SortModeSchema.safeParse(prefs.sort_mode).success
      ? SortModeSchema.parse(prefs.sort_mode)
      : 'folder';
    const svgViewMode = SvgViewModeSchema.safeParse(prefs.svg_view_mode).success
      ? SvgViewModeSchema.parse(prefs.svg_view_mode)
      : 'code';
    const sxsOrientation = SxsOrientationSchema.safeParse(prefs.image_sxs_orientation).success
      ? SxsOrientationSchema.parse(prefs.image_sxs_orientation)
      : 'left-right';
    aiStore.actions.update({
      sortMode,
      riskSortDimension: prefs.risk_sort_dimension ?? 'aggregate',
      showRiskScores: prefs.show_risk_scores ?? true,
    });
    diffViewStore.actions.update({
      ignoreWhitespace: prefs.ignore_whitespace ?? false,
      svgViewMode,
      lastImageMode: prefs.last_image_mode ?? 'side-by-side',
      sxsOrientation,
    });

    // Check if AI is configured
    const config = await getAIConfig();
    aiStore.actions.update({
      aiConfigured: config.keyConfigured,
      guidedReviewEnabled: config.guidedReview.enabled,
    });

    // If in an AI mode, load cached results
    const aiNow = aiStore.state.value;
    if (aiNow.sortMode === "risk" || aiNow.sortMode === "narrative") {
      if (aiNow.aiConfigured) {
        await loadAnalysisResults(aiNow.sortMode);
      } else {
        // Fall back to folder mode if not configured
        aiStore.actions.update({ sortMode: "folder" });
      }
    }
  } catch {
    // AI features unavailable, fall back to folder
    aiStore.actions.update({ sortMode: "folder" });
  }

}

/**
 * Add the refresh + settings-gear buttons to the sidebar header. Split from
 * `initAISorting()` (GB-1087), which is preference/config bootstrap — button
 * creation is a sidebar concern.
 *
 * The share section (#sidebar-share) is populated by the time-gated share
 * prompt in `share.tsx` once the user has spent ~5 min in Glassbox — see
 * `initSharePrompt()`. It is intentionally NOT shown immediately on launch.
 */
function bindSidebarHeaderButtons(): void {
  const sidebarHeader = document.querySelector(".sidebar-header");
  if (sidebarHeader === null) return;

  const refreshBtn = toElement(
    <button className="btn btn-xs refresh-btn" title="Refresh diffs"><IconRefresh /></button>
  );
  refreshBtn.addEventListener("click", () => {
    void (async () => {
    refreshBtn.style.opacity = "0.4";
    refreshBtn.style.pointerEvents = "none";
    try {
      await refreshReview();
      await loadFiles();
      // Server-side diff content changed; same fileId so the fetch
      // effect's dedupe would skip the refetch otherwise.
      invalidateDiffCache();
      const currentFileId = reviewStore.state.value.currentFileId;
      if (currentFileId !== null) {
        void selectFile(currentFileId);
      }
    } catch {
      /* ignore */
    }
    refreshBtn.style.opacity = "";
    refreshBtn.style.pointerEvents = "";
    })();
  });
  sidebarHeader.appendChild(refreshBtn);

  const gearBtn = toElement(
    <button className="btn btn-xs settings-gear" title="Settings"><IconGear /></button>
  );
  gearBtn.addEventListener("click", () => {
    void import("./settings/dialog.js").then((m) => {
      m.showSettingsDialog();
    });
  });
  sidebarHeader.appendChild(gearBtn);
}

async function navigateToEntry(entry: { fileId: string | null; filePath: string | null; scrollLine: number }) {
  setNavigating(true);
  try {
    if (entry.fileId !== null && entry.fileId !== '') {
      await selectFile(entry.fileId);
    } else if (entry.filePath !== null && entry.filePath !== '') {
      // Raw file — fetch and route through the diff mount's signal (so the
      // mount stays the single source of truth for `#diff-container`).
      // `setRawDiffContent()` handles highlighting + toolbar visibility via
      // the post-render effect; we just need to clear sidebar selection and
      // update the nav path label.
      const res = await fetch("/file-raw?path=" + encodeURIComponent(entry.filePath));
      if (res.ok) {
        document.querySelectorAll(".file-item.active").forEach((el) => { el.classList.remove("active"); });
        reviewStore.actions.update({ currentFileId: null });
        setRawDiffContent(entry.filePath, await res.text());
        updateNavFilePath(entry.filePath);
      }
    }
    // Scroll to the saved line position
    requestAnimationFrame(() => {
      const lineEl = document.querySelector(`.diff-line[data-line="${entry.scrollLine}"][data-side="new"]`);
      if (lineEl) lineEl.scrollIntoView({ block: 'start' });
    });
  } finally {
    setNavigating(false);
  }
}

function bindNavButtons() {
  document.getElementById("nav-back-btn")?.addEventListener("click", () => {
    const entry = navBack();
    if (entry) void navigateToEntry(entry);
  });
  document.getElementById("nav-forward-btn")?.addEventListener("click", () => {
    const entry = navForward();
    if (entry) void navigateToEntry(entry);
  });

  // Keyboard shortcuts: Cmd+[ / Cmd+] (macOS), Alt+Left / Alt+Right (Windows/Linux)
  document.addEventListener("keydown", (e) => {
    const isMac = navigator.userAgent.includes("Mac");
    if (isMac && e.metaKey && e.key === "[") {
      e.preventDefault();
      const entry = navBack();
      if (entry) void navigateToEntry(entry);
    } else if (isMac && e.metaKey && e.key === "]") {
      e.preventDefault();
      const entry = navForward();
      if (entry) void navigateToEntry(entry);
    } else if (!isMac && e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      const entry = navBack();
      if (entry) void navigateToEntry(entry);
    } else if (!isMac && e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      const entry = navForward();
      if (entry) void navigateToEntry(entry);
    }
  });
}

async function init() {
  await initDebug();
  await initAISorting();
  bindSidebarHeaderButtons();
  await loadFiles();
  initSidebar();

  // A `?file=&line=` deep-link (doc 34, GB-1144) jumps to a specific file+line
  // after the diff view is ready — e.g. the "open this commit as a review" jump
  // lands on the note's line. When present, skip the auto-select-first below so
  // there's no flash of the wrong file; the jump itself happens after
  // `initDiffView()` (the diff mount must exist for `navigateToLocation`).
  const deepLink = parseDeepLink(window.location.search);

  // Auto-select the first file if none is selected (and no deep-link overrides it)
  const review = reviewStore.state.value;
  const order = visibleFileOrder.value;
  if (deepLink === null && review.currentFileId === null && order.length > 0) {
    void selectFile(order[0]);
  }

  // Auto-start analysis if resuming in an AI mode with no cached results
  const ai = aiStore.state.value;
  if (ai.aiConfigured && (ai.sortMode === "risk" || ai.sortMode === "narrative")) {
    const mode = ai.sortMode;
    const hasResults = mode === "risk" ? ai.riskScores !== null : ai.narrativeOrder !== null;
    const modeState = mode === "risk" ? ai.riskAnalysis : ai.narrativeAnalysis;
    if (!hasResults && modeState.status !== "running") {
      triggerAnalysis(mode);
    }
  }

  // Auto-start guided analysis when guided review is enabled (independent of sort mode)
  if (ai.guidedReviewEnabled && ai.aiConfigured) {
    triggerGuidedAnalysis();
  }

  initDiffView();

  // Honor the `?file=&line=` deep-link now that the diff mount exists. Clean the
  // query out of the URL afterward so a later manual reload doesn't force the
  // jump again and the address bar stays tidy.
  if (deepLink !== null) {
    void navigateToLocation(deepLink.file, deepLink.line);
    window.history.replaceState(null, '', window.location.pathname);
  }

  bindToolbar();
  bindFind();
  bindGoToDefinition();
  bindCompleteButton();
  bindReopenButton();
  initProgress();
  // Accumulating git difftool session (doc 19): live file list + Done +
  // tab-close teardown. No-op unless this page was served for a difftool review.
  initDifftoolSession();
  // Plugin UI extensions (doc 30): render registered elements into the header /
  // diff-toolbar / sidebar-footer slots. No-op when no plugin registers any.
  void initPluginUi();
  document.addEventListener("dragend", () => {
    dragStore.actions.setAnnotation(null);
    document.querySelectorAll(".diff-line.drag-over").forEach((d) => {
      d.classList.remove("drag-over");
    });
  });

  // Navigation stack: back/forward buttons
  bindNavButtons();

  // Track scroll position for nav stack
  const diffContainer = document.getElementById("diff-container");
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  diffContainer?.addEventListener("scroll", () => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      navUpdateScroll(getVisibleScrollLine());
    }, SCROLL_SAVE_DEBOUNCE_MS);
  });
}

async function checkForUpdate() {
  const invoke = getTauriInvoke();
  if (!invoke) return;

  // The Rust update check is async and may not have completed yet.
  // Poll a few times with increasing delays to catch it.
  const delays = UPDATE_POLL_DELAYS_MS;
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const version = (await invoke("get_pending_update")) as string | null;
      if (version !== null && version !== '') {
        showUpdateBanner(version);
        return;
      }
    } catch {
      return;
    }
  }
}

void init();
void checkForUpdate();

// Share prompt — detect demo mode from the review's mode field
void getCurrentReview().then((review) => {
  initSharePrompt(review?.mode === 'demo');
}).catch(() => { /* ignore */ });
