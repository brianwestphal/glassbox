import {
  dismissSharePrompt as apiDismissSharePrompt,
  getAIConfig,
  getAIPreferences,
  getCurrentReview,
  getSharePromptState,
  refreshReview,
  SortModeSchema,
  SvgViewModeSchema,
} from "../api/index.js";
import { IconGear, IconHeart, IconRefresh } from "../icons.js";
import { initDebug } from "./api.js";
import { bindFind } from "./diff/find.js";
import { bindGoToDefinition } from "./diff/goToDefinition.js";
import { initDiffView, invalidateDiffCache, setRawDiffContent, updateNavFilePath } from "./diff/index.js";
import { getVisibleScrollLine, navBack, navForward, navUpdateScroll, setNavigating } from "./diff/navStack.js";
import { selectFile } from "./diff/selection.js";
import { bindToolbar } from "./diff/toolbar.js";
import { toElement } from "./dom.js";
import { triggerGuidedAnalysis } from "./guided.js";
import { bindCompleteButton, bindReopenButton } from "./review/modal.js";
import { initProgress } from "./review/progress.js";
import { initSharePrompt, triggerShare } from "./share.js";
import { loadFiles } from "./sidebar/fileTree.js";
import { initSidebar } from "./sidebar/index.js";
import { loadAnalysisResults, triggerAnalysis } from "./sidebar/sortMode.js";
import { aiStore, diffViewStore, dragStore, reviewStore, visibleFileOrder } from "./stores/index.js";
// --- Tauri update notification ---
import { getTauriInvoke, openExternalUrl, showUpdateBanner } from "./tauri.js";

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
    aiStore.actions.update({
      sortMode,
      riskSortDimension: prefs.risk_sort_dimension ?? 'aggregate',
      showRiskScores: prefs.show_risk_scores ?? true,
    });
    diffViewStore.actions.update({
      ignoreWhitespace: prefs.ignore_whitespace ?? false,
      svgViewMode,
      lastImageMode: prefs.last_image_mode ?? 'metadata',
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

  // Add refresh and settings buttons to sidebar header
  const sidebarHeader = document.querySelector(".sidebar-header");
  if (sidebarHeader !== null) {
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

  // Share section above the footer
  const shareContainer = document.getElementById("sidebar-share");
  if (shareContainer) {
    // Check if share section was dismissed
    void getSharePromptState().then((state) => {
      if (state.dismissedAt !== null) {
        const elapsed = Date.now() - state.dismissedAt;
        if (elapsed < 30 * 24 * 60 * 60 * 1000) return; // within 30-day cooldown
      }
      const shareSection = toElement(
        <div className="sidebar-share-section">
          <button className="sidebar-share-dismiss" id="share-dismiss-btn" title="Dismiss">&times;</button>
          <p className="sidebar-share-label">Love Glassbox?</p>
          <div className="sidebar-share-actions">
            <button className="btn btn-share" id="share-glassbox-btn">Share</button>
            <a className="btn btn-sponsor" id="sponsor-glassbox-btn" href="https://github.com/sponsors/brianwestphal" target="_blank" rel="noopener noreferrer"><IconHeart />Sponsor</a>
          </div>
        </div>
      );
      shareSection.querySelector("#share-glassbox-btn")?.addEventListener("click", () => {
        void triggerShare();
      });
      // In the Tauri desktop shell, `target="_blank"` never reaches a real
      // browser, so route the Sponsor link through the OS default browser.
      // In a plain browser this is a no-op and the anchor opens normally.
      shareSection.querySelector("#sponsor-glassbox-btn")?.addEventListener("click", (e) => {
        if (openExternalUrl("https://github.com/sponsors/brianwestphal")) {
          e.preventDefault();
        }
      });
      shareSection.querySelector("#share-dismiss-btn")?.addEventListener("click", () => {
        shareSection.remove();
        void apiDismissSharePrompt();
      });
      shareContainer.appendChild(shareSection);
    }).catch(() => { /* ignore */ });
  }
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
  await loadFiles();
  initSidebar();

  // Auto-select the first file if none is selected
  const review = reviewStore.state.value;
  const order = visibleFileOrder.value;
  if (review.currentFileId === null && order.length > 0) {
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
  bindToolbar();
  bindFind();
  bindGoToDefinition();
  bindCompleteButton();
  bindReopenButton();
  initProgress();
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
    }, 300);
  });
}

async function checkForUpdate() {
  const invoke = getTauriInvoke();
  if (!invoke) return;

  // The Rust update check is async and may not have completed yet.
  // Poll a few times with increasing delays to catch it.
  const delays = [0, 3000, 10000];
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
