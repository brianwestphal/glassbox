import { IconGear, IconRefresh } from "../icons.js";
import { api, initDebug } from "./api.js";
import { toElement } from "./dom.js";
import { bindFind } from "./diff/find.js";
import { bindGoToDefinition } from "./diff/goToDefinition.js";
import { initScrollSync } from "./diff/mode.js";
import { navBack, navForward, navUpdateScroll, getVisibleScrollLine, setNavigating } from "./diff/navStack.js";
import { updateNavFilePath } from "./diff/selection.js";
import { selectFile } from "./diff/selection.js";
import { bindToolbar } from "./diff/toolbar.js";
import { triggerGuidedAnalysis } from "./guided.js";
import { bindCompleteButton, bindReopenButton } from "./review/modal.js";
import { updateProgress } from "./review/progress.js";
import { bindFileFilter, bindSidebarEvents, bindSidebarResize } from "./sidebar/controls.js";
import { loadFiles } from "./sidebar/fileTree.js";
import { bindSortMode, loadAnalysisResults, renderSortControl, triggerAnalysis } from "./sidebar/sortMode.js";
import type { SortMode } from "./state.js";
import { state } from "./state.js";

async function initAISorting() {
  try {
    // Load user preferences
    const prefs = await api<{ sort_mode: string; risk_sort_dimension: string; show_risk_scores: boolean; ignore_whitespace: boolean; svg_view_mode: string; last_image_mode: string }>(
      "/ai/preferences",
    );
    state.sortMode = prefs.sort_mode as SortMode;
    state.riskSortDimension = prefs.risk_sort_dimension;
    state.showRiskScores = prefs.show_risk_scores;
    state.ignoreWhitespace = prefs.ignore_whitespace ?? false;
    state.svgViewMode = (prefs.svg_view_mode as 'code' | 'rendered') ?? 'code';
    state.lastImageMode = prefs.last_image_mode ?? 'metadata';

    // Check if AI is configured
    const config = await api<{ keyConfigured: boolean; guidedReview: { enabled: boolean } }>("/ai/config");
    state.aiConfigured = config.keyConfigured;
    state.guidedReviewEnabled = config.guidedReview.enabled;

    // If in an AI mode, load cached results
    if (state.sortMode === "risk" || state.sortMode === "narrative") {
      if (state.aiConfigured) {
        await loadAnalysisResults(state.sortMode);
      } else {
        // Fall back to folder mode if not configured
        state.sortMode = "folder";
      }
    }
  } catch {
    // AI features unavailable, fall back to folder
    state.sortMode = "folder";
  }

  // Inject sort control into the sidebar
  const filterEl = document.querySelector(".file-filter");
  if (filterEl !== null) {
    const control = renderSortControl();
    filterEl.after(control);
    bindSortMode();
  }

  // Add refresh and settings buttons to sidebar header
  const sidebarHeader = document.querySelector(".sidebar-header");
  if (sidebarHeader !== null) {
    const refreshBtn = toElement(
      <button className="btn btn-xs refresh-btn" title="Refresh diffs"><IconRefresh /></button>
    );
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.style.opacity = "0.4";
      refreshBtn.style.pointerEvents = "none";
      try {
        await api<{ updated: number; added: number; stale: number; fileCount: number }>("/review/refresh", {
          method: "POST",
        });
        await loadFiles();
        if (state.currentFileId !== null) {
          void selectFile(state.currentFileId);
        }
        updateProgress();
      } catch {
        /* ignore */
      }
      refreshBtn.style.opacity = "";
      refreshBtn.style.pointerEvents = "";
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
}

async function navigateToEntry(entry: { fileId: string | null; filePath: string | null; scrollLine: number }) {
  setNavigating(true);
  try {
    if (entry.fileId) {
      await selectFile(entry.fileId);
    } else if (entry.filePath) {
      // Raw file — fetch and display
      const container = document.getElementById("diff-container");
      if (!container) return;
      const res = await fetch("/file-raw?path=" + encodeURIComponent(entry.filePath));
      if (res.ok) {
        container.innerHTML = await res.text();
        container.style.display = "block";
        const { detectLanguage: dl, applyHighlighting: ah } = await import("./diff/highlight.js");
        state._detectedLang = dl(entry.filePath);
        if (state.highlightAuto) state.highlightLang = state._detectedLang;
        ah();
        document.querySelectorAll(".file-item.active").forEach((el) => el.classList.remove("active"));
        state.currentFileId = null;
        updateNavFilePath(entry.filePath);
      }
    }
    // Scroll to the saved line position
    requestAnimationFrame(() => {
      const lineEl = document.querySelector(`.diff-line[data-line="${entry.scrollLine}"][data-side="new"]`) as HTMLElement | null;
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
    const isMac = navigator.platform.includes("Mac");
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

  // Auto-select the first file if none is selected
  if (state.currentFileId === null && state.fileOrder.length > 0) {
    void selectFile(state.fileOrder[0]);
  }

  // Auto-start analysis if resuming in an AI mode with no cached results
  if (state.aiConfigured && (state.sortMode === "risk" || state.sortMode === "narrative")) {
    const mode = state.sortMode;
    const hasResults = mode === "risk" ? state.riskScores !== null : state.narrativeOrder !== null;
    const modeState = mode === "risk" ? state.riskAnalysis : state.narrativeAnalysis;
    if (!hasResults && modeState.status !== "running") {
      triggerAnalysis(mode);
    }
  }

  // Auto-start guided analysis when guided review is enabled (independent of sort mode)
  if (state.guidedReviewEnabled && state.aiConfigured) {
    triggerGuidedAnalysis();
  }

  bindSidebarEvents();
  bindToolbar();
  bindFind();
  bindGoToDefinition();
  bindFileFilter();
  bindSidebarResize();
  bindCompleteButton();
  bindReopenButton();
  initScrollSync();
  updateProgress();
  document.addEventListener("dragend", () => {
    state._dragAnnotation = null;
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

// --- Tauri update notification ---

import { getTauriInvoke, showUpdateBanner } from "./tauri.js";

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
      if (version) {
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
