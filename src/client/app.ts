import { api, initDebug } from "./api.js";
import { initScrollSync } from "./diff/mode.js";
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
    const prefs = await api<{ sort_mode: string; risk_sort_dimension: string; show_risk_scores: boolean; ignore_whitespace: boolean }>(
      "/ai/preferences",
    );
    state.sortMode = prefs.sort_mode as SortMode;
    state.riskSortDimension = prefs.risk_sort_dimension;
    state.showRiskScores = prefs.show_risk_scores;
    state.ignoreWhitespace = prefs.ignore_whitespace ?? false;

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
    const refreshBtn = document.createElement("button");
    refreshBtn.className = "btn btn-xs refresh-btn";
    refreshBtn.title = "Refresh diffs";
    refreshBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="21 3 21 9 15 9"/></svg>';
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.style.opacity = "0.4";
      refreshBtn.style.pointerEvents = "none";
      try {
        const result = await api<{ updated: number; added: number; stale: number; fileCount: number }>("/review/refresh", {
          method: "POST",
        });
        await loadFiles();
        // Re-select current file to pick up diff changes
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

    const gearBtn = document.createElement("button");
    gearBtn.className = "btn btn-xs settings-gear";
    gearBtn.title = "Settings";
    gearBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
    gearBtn.addEventListener("click", () => {
      void import("./settings/dialog.js").then((m) => {
        m.showSettingsDialog();
      });
    });
    sidebarHeader.appendChild(gearBtn);
  }
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
