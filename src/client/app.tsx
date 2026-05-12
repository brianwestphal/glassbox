import { IconGear, IconRefresh } from "../icons.js";
import { api, initDebug } from "./api.js";
import { bindFind } from "./diff/find.js";
import { bindGoToDefinition } from "./diff/goToDefinition.js";
import { initScrollSync } from "./diff/mode.js";
import { getVisibleScrollLine, navBack, navForward, navUpdateScroll, setNavigating } from "./diff/navStack.js";
import { selectFile,updateNavFilePath  } from "./diff/selection.js";
import { bindToolbar } from "./diff/toolbar.js";
import { toElement } from "./dom.js";
import { triggerGuidedAnalysis } from "./guided.js";
import { bindCompleteButton, bindReopenButton } from "./review/modal.js";
import { updateProgress } from "./review/progress.js";
import { initSharePrompt, triggerShare } from "./share.js";
import { bindFileFilter, bindSidebarEvents, bindSidebarResize } from "./sidebar/controls.js";
import { loadFiles } from "./sidebar/fileTree.js";
import { bindSortMode, loadAnalysisResults, renderSortControl, triggerAnalysis } from "./sidebar/sortMode.js";
import type { SortMode } from "./state.js";
import { aiStore, diffViewStore, dragStore, reviewStore } from "./stores/index.js";
// --- Tauri update notification ---
import { getTauriInvoke, showUpdateBanner } from "./tauri.js";

async function initAISorting() {
  try {
    // Load user preferences
    const prefs = await api<{ sort_mode: string; risk_sort_dimension: string; show_risk_scores: boolean; ignore_whitespace: boolean; svg_view_mode: string; last_image_mode: string }>(
      "/ai/preferences",
    );
    aiStore.actions.update({
      sortMode: prefs.sort_mode as SortMode,
      riskSortDimension: prefs.risk_sort_dimension,
      showRiskScores: prefs.show_risk_scores,
    });
    diffViewStore.actions.update({
      ignoreWhitespace: prefs.ignore_whitespace,
      svgViewMode: prefs.svg_view_mode as 'code' | 'rendered',
      lastImageMode: prefs.last_image_mode,
    });

    // Check if AI is configured
    const config = await api<{ keyConfigured: boolean; guidedReview: { enabled: boolean } }>("/ai/config");
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
    refreshBtn.addEventListener("click", () => {
      void (async () => {
      refreshBtn.style.opacity = "0.4";
      refreshBtn.style.pointerEvents = "none";
      try {
        await api<{ updated: number; added: number; stale: number; fileCount: number }>("/review/refresh", {
          method: "POST",
        });
        await loadFiles();
        const currentFileId = reviewStore.state.value.currentFileId;
        if (currentFileId !== null) {
          void selectFile(currentFileId);
        }
        updateProgress();
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
    void api<{ dismissedAt: number | null }>('/share-prompt/state').then((state) => {
      if (state.dismissedAt !== null) {
        const elapsed = Date.now() - state.dismissedAt;
        if (elapsed < 30 * 24 * 60 * 60 * 1000) return; // within 30-day cooldown
      }
      const shareSection = toElement(
        <div className="sidebar-share-section">
          <button className="sidebar-share-dismiss" id="share-dismiss-btn" title="Dismiss">&times;</button>
          <p className="sidebar-share-label">Know someone who'd love this?</p>
          <button className="btn btn-share" id="share-glassbox-btn">Share Glassbox</button>
        </div>
      );
      shareSection.querySelector("#share-glassbox-btn")?.addEventListener("click", () => {
        void triggerShare();
      });
      shareSection.querySelector("#share-dismiss-btn")?.addEventListener("click", () => {
        shareSection.remove();
        void api('/share-prompt/dismiss', { method: 'POST' });
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
      // Raw file — fetch and display
      const container = document.getElementById("diff-container");
      if (!container) return;
      const res = await fetch("/file-raw?path=" + encodeURIComponent(entry.filePath));
      if (res.ok) {
        container.innerHTML = await res.text();
        container.style.display = "block";
        const { detectLanguage: dl, applyHighlighting: ah } = await import("./diff/highlight.js");
        const detectedLang = dl(entry.filePath);
        diffViewStore.actions.update({
          detectedLang,
          ...(diffViewStore.state.value.highlightAuto ? { highlightLang: detectedLang } : {}),
        });
        ah();
        document.querySelectorAll(".file-item.active").forEach((el) => { el.classList.remove("active"); });
        reviewStore.actions.update({ currentFileId: null });
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

  // Auto-select the first file if none is selected
  const review = reviewStore.state.value;
  if (review.currentFileId === null && review.fileOrder.length > 0) {
    void selectFile(review.fileOrder[0]);
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
void api<{ mode: string }>('/review').then((review) => {
  initSharePrompt(review.mode === 'demo');
}).catch(() => { /* ignore */ });
