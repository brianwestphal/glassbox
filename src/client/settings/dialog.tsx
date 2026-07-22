import type { SafeHtml, Signal } from 'kerfjs';
import { delegate, mount, signal } from 'kerfjs';

import type { AIPlatform, DifftoolStatusResp, KeyStorage } from '../../api/index.js';
import {
  deleteAIKey,
  disableChannel,
  enableChannel,
  getAIConfig,
  getAIKeyStatus,
  getChannelStatus,
  getClaudeCheck,
  getDifftoolStatus,
  getProjectSettings,
  listAIModels,
  listThemes,
  registerDifftool,
  saveAIConfig,
  saveAIKey,
  unregisterDifftool,
  updateProjectSettings,
} from '../../api/index.js';
import { asButton, asEl, asInput, asSelect, toElement } from '../dom.js';
import { invalidateGuidedAnalysis } from '../guided.js';
import { triggerShare } from '../share.js';
import { invalidateAnalysisCache } from '../sidebar/sortMode.js';
import { aiStore } from '../stores/index.js';
import { getTauriGlobal, getTauriInvoke, showUpdateBanner } from '../tauri.js';
import { switchTheme } from '../themes.js';
import { CHANNEL_STATUS_POLL_MS, SETTINGS_APP_NAME_DEBOUNCE_MS, SETTINGS_CONFIG_DEBOUNCE_MS, TOAST_DURATION_MS } from '../timing.js';
import { experimentalTab } from './experimentalTab.js';
import { generalTab } from './generalTab.js';
import { browsePluginFolder, doInstallBundled, doInstallPlugin, doPluginAction, doUninstallPlugin, loadPluginsList, pluginsTab, resetPluginsTab, setPreference, togglePluginDisabled } from './pluginsTab.js';
import { ALL_LANG_KEYS, profileTab } from './profileTab.js';
import type { ChannelState, ConfigResponse, KeyStatusResponse, ModelsResponse, ProjectSettings, Tab, TabContext, ThemesResponse } from './tabContext.js';
import { showThemeManager } from './themeManager.js';
import { updatesTab } from './updatesTab.js';

const TABS: Tab[] = [generalTab, profileTab, experimentalTab, pluginsTab, updatesTab];

interface SettingsUIState {
  activeTab: string;
  currentPlatform: string;
  currentModel: string;
  // Apple-FM fallback selection (empty string = none).
  fallbackPlatform: string;
  fallbackModel: string;
  localEndpoint: string;
  guidedEnabled: boolean;
  guidedTopics: Set<string>;
  showMoreLangs: boolean;
  appName: string;
  activeThemeId: string;
  // GB-850 — current `git difftool` registration state. Updated after
  // register/unregister actions so the General tab's button re-renders.
  difftoolStatus: DifftoolStatusResp;
}

export function showSettingsDialog(onClose?: () => void): void {
  resetPluginsTab(); // fresh plugin list per dialog session (doc 29, GB-1040)
  void (async () => {
    const [keyStatus, modelsData, configData, projectSettings, themesData, channelCheck, channelStatus, difftoolStatus] = await Promise.all([
      getAIKeyStatus(),
      listAIModels(),
      getAIConfig(),
      getProjectSettings(),
      listThemes(),
      getClaudeCheck(),
      getChannelStatus(),
      getDifftoolStatus(),
    ]);

    const channelState: ChannelState = {
      enabled: channelStatus.enabled,
      connected: channelStatus.connected,
      claudeInstalled: channelCheck.installed,
      claudeVersion: channelCheck.version,
      meetsMinimum: channelCheck.meetsMinimum,
    };

    renderSettingsModal(keyStatus, modelsData, configData, projectSettings, themesData, channelState, difftoolStatus, onClose);
  })();
}

function renderSettingsModal(
  keyStatus: KeyStatusResponse,
  modelsData: ModelsResponse,
  configData: ConfigResponse,
  projectSettings: ProjectSettings,
  themesData: ThemesResponse,
  channelState: ChannelState,
  initialDifftoolStatus: DifftoolStatusResp,
  onClose?: () => void,
): void {
  const isTauri = getTauriGlobal() !== undefined;

  // Per-dialog reactive state. Bumps to this signal drive the mount()
  // re-render. The signal lives in this closure (not in the global
  // `stores/index.ts`) because it represents a transient modal — opening the
  // dialog a second time should fetch fresh server data and reset live UI.
  const ui = signal<SettingsUIState>({
    activeTab: 'general',
    currentPlatform: configData.platform,
    currentModel: configData.model,
    fallbackPlatform: configData.fallbackPlatform ?? '',
    fallbackModel: configData.fallbackModel ?? '',
    localEndpoint: configData.localEndpoint,
    guidedEnabled: configData.guidedReview.enabled,
    guidedTopics: new Set(configData.guidedReview.topics),
    showMoreLangs: false,
    appName: projectSettings.appName ?? '',
    activeThemeId: themesData.activeId,
    difftoolStatus: initialDifftoolStatus,
  });

  const overlay = toElement(<div className="modal-overlay"><div className="modal settings-dialog"></div></div>);
  const modalEl = overlay.querySelector<HTMLElement>('.modal');
  if (modalEl === null) return;

  function setUi(partial: Partial<SettingsUIState>): void {
    ui.value = { ...ui.value, ...partial };
  }
  function forceRerender(): void {
    ui.value = { ...ui.value };
  }

  const actions = createActions({ ui, setUi, forceRerender, keyStatus, projectSettings, configData, channelState, overlay, modelsData, themesData });

  let disposeMount: (() => void) | null = null;

  // Periodic Claude-channel health poll (doc 17.3). While the dialog is open we
  // re-read `/api/channel/status` so the connected/disconnected indicator stays
  // live as a Claude Code session attaches or drops. Mutating the shared
  // `channelState` object + bumping the render signal is enough — the mount
  // re-reads it. Transient fetch failures keep the last known state.
  const channelPoll = setInterval(() => {
    void (async () => {
      try {
        const s = await getChannelStatus();
        if (s.enabled !== channelState.enabled || s.connected !== channelState.connected) {
          channelState.enabled = s.enabled;
          channelState.connected = s.connected;
          forceRerender();
        }
      } catch { /* transient — keep last known state */ }
    })();
  }, CHANNEL_STATUS_POLL_MS);

  function closeDialog(): void {
    actions.dispose();
    clearInterval(channelPoll);
    document.removeEventListener('keydown', handleEscape);
    if (disposeMount !== null) disposeMount();
    overlay.remove();
    if (onClose !== undefined) onClose();
  }

  function handleEscape(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeDialog();
  }

  // Mount the reactive shell.
  disposeMount = mount(modalEl, () => {
    const ctx = buildContext({ ui, isTauri, keyStatus, modelsData, themesData, projectSettings, channelState, actions });
    const visible = TABS.filter(t => t.enabled === undefined || t.enabled(ctx));
    const cur = ui.value;
    let activeId = cur.activeTab;
    if (!visible.some(t => t.id === activeId)) {
      activeId = visible[0]?.id ?? 'general';
      // Defer the state correction so we don't write during a render.
      queueMicrotask(() => { setUi({ activeTab: activeId }); });
    }
    return renderShell(visible, activeId, ctx);
  });

  setupDelegates({ overlay, setUi, forceRerender, actions, modelsData, themesData, channelState, closeDialog });

  document.addEventListener('keydown', handleEscape);
  document.body.appendChild(overlay);
}

// --- Action handlers (closure-bound, returned as an object so they can be
//     passed to TabContext + the delegate setup without duplicating closure
//     wiring).

interface ActionDeps {
  ui: Signal<SettingsUIState>;
  setUi: (p: Partial<SettingsUIState>) => void;
  forceRerender: () => void;
  keyStatus: KeyStatusResponse;
  projectSettings: ProjectSettings;
  configData: ConfigResponse;
  channelState: ChannelState;
  overlay: HTMLElement;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
}

interface Actions {
  saveConfig: () => void;
  saveConfigDebounced: () => void;
  saveLocalEndpoint: (endpoint: string) => void;
  saveAppNameDebounced: () => void;
  saveKey: () => void;
  removeKey: () => void;
  saveFallbackKey: () => void;
  removeFallbackKey: () => void;
  toggleTopic: (topic: string) => void;
  registerDifftoolAction: () => void;
  unregisterDifftoolAction: () => void;
  dispose: () => void;
}

function createActions(deps: ActionDeps): Actions {
  const { ui, setUi, forceRerender, keyStatus, projectSettings, configData, overlay } = deps;
  let lastSavedGuidedEnabled = configData.guidedReview.enabled;
  let lastSavedGuidedTopics = new Set(configData.guidedReview.topics);
  let configTimer: ReturnType<typeof setTimeout> | null = null;
  let appNameTimer: ReturnType<typeof setTimeout> | null = null;

  /** Surface a transient error when a settings save/remove request fails, so a
   *  failure isn't silent. Appended to `overlay` (not the mounted modal body)
   *  so a re-render can't clobber it; auto-dismisses. */
  function flashSettingsError(message: string): void {
    overlay.querySelector('.settings-error-toast')?.remove();
    const toast = toElement(<div className="settings-error-toast">{message}</div>);
    overlay.appendChild(toast);
    setTimeout(() => { toast.remove(); }, TOAST_DURATION_MS);
  }

  function saveConfig(): void {
    const cur = ui.value;
    const newTopics = Array.from(cur.guidedTopics);
    const guidedChanged = cur.guidedEnabled !== lastSavedGuidedEnabled
      || newTopics.length !== lastSavedGuidedTopics.size
      || newTopics.some(t => !lastSavedGuidedTopics.has(t));

    void (async () => {
      try {
        await saveAIConfig({
          platform: cur.currentPlatform as AIPlatform,
          model: cur.currentModel,
          localEndpoint: cur.localEndpoint,
          guidedReview: { enabled: cur.guidedEnabled, topics: newTopics },
          // Only send the fallback while Apple is the primary — otherwise omit
          // it so an unrelated save doesn't clear the stored selection.
          ...(cur.currentPlatform === 'apple'
            ? { fallbackPlatform: cur.fallbackPlatform, fallbackModel: cur.fallbackModel }
            : {}),
        });

        const newConfig = await getAIConfig();
        aiStore.actions.update({
          aiConfigured: newConfig.keyConfigured,
          guidedReviewEnabled: cur.guidedEnabled,
        });
        configData.guidedReview = { enabled: cur.guidedEnabled, topics: newTopics };

        if (guidedChanged && aiStore.state.value.aiConfigured) {
          invalidateAnalysisCache();
          invalidateGuidedAnalysis();
        }

        lastSavedGuidedEnabled = cur.guidedEnabled;
        lastSavedGuidedTopics = new Set(cur.guidedTopics);
      } catch {
        flashSettingsError('Couldn’t save settings — please try again.');
      }
    })();
  }

  // Save the local base URL, then re-discover models against it so the model
  // dropdown reflects what the (possibly just-changed) server offers.
  function saveLocalEndpoint(endpoint: string): void {
    setUi({ localEndpoint: endpoint });
    void (async () => {
      try {
        const cur = ui.value;
        await saveAIConfig({ platform: cur.currentPlatform as AIPlatform, model: cur.currentModel, localEndpoint: endpoint });
        const fresh = await listAIModels();
        deps.modelsData.models.local = fresh.models.local;
        forceRerender();
      } catch {
        flashSettingsError('Couldn’t reach the local model server at that URL.');
      }
    })();
  }

  function saveConfigDebounced(): void {
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(saveConfig, SETTINGS_CONFIG_DEBOUNCE_MS);
  }

  function saveAppNameDebounced(): void {
    if (appNameTimer) clearTimeout(appNameTimer);
    appNameTimer = setTimeout(() => {
      const val = ui.value.appName.trim();
      if (val !== (projectSettings.appName ?? '')) {
        void updateProjectSettings({ appName: val });
        projectSettings.appName = val || undefined;
      }
    }, SETTINGS_APP_NAME_DEBOUNCE_MS);
  }

  // Save/remove are parameterized by platform + element ids so the same logic
  // serves the primary platform's key block and the Apple-FM fallback's.
  function saveKeyFor(platform: string, inputId: string, storageName: string): void {
    if (platform === '') return;
    const keyInput = overlay.querySelector<HTMLInputElement>(`#${inputId}`);
    if (keyInput === null || keyInput.value.trim() === '') return;
    const storageRadio = overlay.querySelector<HTMLInputElement>(`input[name="${storageName}"]:checked`);
    const storage = storageRadio?.value ?? 'config';
    void (async () => {
      try {
        await saveAIKey({ platform: platform as AIPlatform, key: keyInput.value.trim(), storage: storage as KeyStorage });
        const newStatus = await getAIKeyStatus();
        keyStatus.status = newStatus.status;
        const newConfig = await getAIConfig();
        aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
        forceRerender();
      } catch {
        flashSettingsError('Couldn’t save the API key — please try again.');
      }
    })();
  }

  function removeKeyFor(platform: string): void {
    if (platform === '') return;
    void (async () => {
      try {
        await deleteAIKey({ platform: platform as AIPlatform });
        const newStatus = await getAIKeyStatus();
        keyStatus.status = newStatus.status;
        const newConfig = await getAIConfig();
        aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
        forceRerender();
      } catch {
        flashSettingsError('Couldn’t remove the API key — please try again.');
      }
    })();
  }

  const saveKey = (): void => { saveKeyFor(ui.value.currentPlatform, 'settings-key', 'key-storage'); };
  const removeKey = (): void => { removeKeyFor(ui.value.currentPlatform); };
  const saveFallbackKey = (): void => { saveKeyFor(ui.value.fallbackPlatform, 'settings-fallback-key', 'fallback-key-storage'); };
  const removeFallbackKey = (): void => { removeKeyFor(ui.value.fallbackPlatform); };

  function toggleTopic(topic: string): void {
    const cur = ui.value;
    const next = new Set(cur.guidedTopics);
    let showMoreLangs = cur.showMoreLangs;
    if (next.has(topic)) {
      next.delete(topic);
    } else {
      next.add(topic);
      if (topic === 'programming') {
        const hasAnyLang = [...next].some(t => ALL_LANG_KEYS.has(t));
        if (!hasAnyLang) {
          for (const key of ALL_LANG_KEYS) next.add(key);
          showMoreLangs = true;
        }
      }
    }
    setUi({ guidedTopics: next, showMoreLangs });
    saveConfigDebounced();
  }

  // GB-850 / GB-852 — register/unregister `glassbox-difftool` at --global
  // scope. The dialog already shows the current `diff.tool` in its status
  // row, so when the displayed status is a non-Glassbox tool, the button
  // sends `force: true` directly (no redundant `window.confirm()` — the row
  // itself was the confirmation, and we used to rely on the WKWebView
  // confirm-panel handler which adds a moving part). On any failure we
  // surface the server's actual error message so the user can act on it
  // instead of staring at a generic "please try again" toast (GB-852).
  async function refreshDifftoolStatus(): Promise<void> {
    try {
      const s = await getDifftoolStatus();
      setUi({ difftoolStatus: s });
    } catch {
      // Non-fatal — UI just shows the prior status until the next open.
    }
  }
  function registerDifftoolAction(): void {
    void (async () => {
      try {
        const cur = ui.value.difftoolStatus;
        // Force only when we already know the displayed `diff.tool` belongs to
        // someone else — that's a deliberate "Replace" click. For a clean slate
        // (no tool set, or already Glassbox), let the server's conflict guard
        // run as a safety net in case the value changed since the dialog opened.
        const force = cur.tool !== null && cur.tool !== 'glassbox';
        let res = await registerDifftool({ force });
        // Race: status changed under us between fetch and click. If the server
        // reports a conflict we didn't anticipate, retry once with force.
        if (!res.ok && res.reason === 'conflict') {
          res = await registerDifftool({ force: true });
        }
        if (!res.ok) {
          const detail = res.reason === 'git-failed'
            ? `Couldn’t register the git difftool — ${res.message}`
            : `Couldn’t register the git difftool — please try again.`;
          flashSettingsError(detail);
          return;
        }
        await refreshDifftoolStatus();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        flashSettingsError(`Couldn’t register the git difftool — ${msg}`);
      }
    })();
  }
  function unregisterDifftoolAction(): void {
    void (async () => {
      try {
        await unregisterDifftool();
        await refreshDifftoolStatus();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        flashSettingsError(`Couldn’t unregister the git difftool — ${msg}`);
      }
    })();
  }

  function dispose(): void {
    if (configTimer) clearTimeout(configTimer);
    if (appNameTimer) clearTimeout(appNameTimer);
  }

  return { saveConfig, saveConfigDebounced, saveLocalEndpoint, saveAppNameDebounced, saveKey, removeKey, saveFallbackKey, removeFallbackKey, toggleTopic, registerDifftoolAction, unregisterDifftoolAction, dispose };
}

// --- TabContext construction ---

function buildContext(args: {
  ui: Signal<SettingsUIState>;
  isTauri: boolean;
  keyStatus: KeyStatusResponse;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
  projectSettings: ProjectSettings;
  channelState: ChannelState;
  actions: Actions;
}): TabContext {
  const cur = args.ui.value;
  return {
    keyStatus: args.keyStatus, modelsData: args.modelsData, themesData: args.themesData,
    projectSettings: args.projectSettings, channelState: args.channelState,
    isTauri: args.isTauri,
    currentPlatform: cur.currentPlatform,
    currentModel: cur.currentModel,
    fallbackPlatform: cur.fallbackPlatform,
    fallbackModel: cur.fallbackModel,
    localEndpoint: cur.localEndpoint,
    guidedEnabled: cur.guidedEnabled,
    guidedTopics: cur.guidedTopics,
    showMoreLangs: cur.showMoreLangs,
    appName: cur.appName,
    activeThemeId: cur.activeThemeId,
    difftoolStatus: cur.difftoolStatus,
    saveConfig: args.actions.saveConfig,
    saveKey: args.actions.saveKey,
    removeKey: args.actions.removeKey,
    toggleTopic: args.actions.toggleTopic,
    saveAppNameDebounced: args.actions.saveAppNameDebounced,
    switchTheme: (id: string) => void switchTheme(id),
    showThemeManager,
    refreshThemes: () => listThemes().then(updated => {
      args.themesData.themes = updated.themes;
      args.themesData.activeId = updated.activeId;
      return updated;
    }),
  };
}

// --- Delegated event handlers ---
// One `delegate(overlay, …)` per concern; fires for every re-render
// automatically. Grouped by tab for readability.

function setupDelegates(args: {
  overlay: HTMLElement;
  setUi: (p: Partial<SettingsUIState>) => void;
  forceRerender: () => void;
  actions: Actions;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
  channelState: ChannelState;
  closeDialog: () => void;
}): void {
  const { overlay, setUi, forceRerender, actions, modelsData, themesData, channelState, closeDialog } = args;

  void delegate(overlay, 'click', '#settings-close', closeDialog);
  void delegate(overlay, 'click', '[data-tab]', (_e, btn) => {
    const t = asEl(btn).dataset.tab;
    if (t === undefined) return;
    setUi({ activeTab: t });
    if (t === 'plugins') loadPluginsList();
  });

  // Plugins tab (doc 29, GB-1040)
  void delegate(overlay, 'change', '[data-plugin-toggle]', (_e, el) => {
    const cb = asInput(el);
    const scope = asEl(el).dataset.pluginToggle;
    const id = asEl(el).dataset.pluginId;
    if ((scope === 'global' || scope === 'project') && id !== undefined) {
      togglePluginDisabled(id, scope, !cb.checked); // unchecked = disabled
    }
  });
  void delegate(overlay, 'click', '[data-plugin-uninstall]', (_e, el) => {
    const id = asEl(el).dataset.pluginUninstall;
    if (id !== undefined) doUninstallPlugin(id);
  });
  void delegate(overlay, 'click', '#plugin-install-btn', () => {
    const input = overlay.querySelector('#plugin-install-path');
    if (input !== null) doInstallPlugin(asInput(input).value);
  });
  void delegate(overlay, 'click', '#plugin-browse-btn', () => { browsePluginFolder(); });
  // Install an opt-in bundled plugin (doc 29 §29.2, GB-1069): readiness check +
  // auto-provision; the result (ready / needs-setup instructions) renders in the row.
  void delegate(overlay, 'click', '[data-plugin-install-bundled]', (_e, el) => {
    const id = asEl(el).dataset.pluginInstallBundled;
    if (id !== undefined) doInstallBundled(id);
  });
  // Config-layout button actions (doc 29 FR-29.18): run the plugin's onAction,
  // then the refreshed list re-renders any dynamic labels the action set.
  void delegate(overlay, 'click', '[data-plugin-action]', (_e, el) => {
    const id = asEl(el).dataset.pluginAction;
    const actionId = asEl(el).dataset.pluginActionId;
    if (id !== undefined && actionId !== undefined) doPluginAction(id, actionId);
  });
  // Plugin preference edits (doc 29 FR-29.12). Selects/checkboxes save on change;
  // text/number inputs save on blur (change) so we don't reload on every keystroke.
  void delegate(overlay, 'change', '[data-plugin-pref-key]', (_e, el) => {
    const node = asEl(el);
    const id = node.dataset.pluginPrefId;
    const key = node.dataset.pluginPrefKey;
    if (id === undefined || key === undefined) return;
    // A `select`-type preference is an HTMLSelectElement, not an <input>; read its
    // value directly (asInput would throw on it — GB-1070).
    const value = node instanceof HTMLSelectElement
      ? node.value
      : (() => { const input = asInput(node); return input.type === 'checkbox' ? String(input.checked) : input.value; })();
    setPreference(id, key, value);
  });

  // General tab
  void delegate(overlay, 'change', '#settings-theme', (_e, sel) => {
    const id = asSelect(sel).value;
    setUi({ activeThemeId: id });
    void switchTheme(id);
  });
  void delegate(overlay, 'click', '#manage-themes-btn', () => {
    showThemeManager(() => {
      void (async () => {
        const updated = await listThemes();
        themesData.themes = updated.themes;
        themesData.activeId = updated.activeId;
        setUi({ activeThemeId: updated.activeId });
      })();
    });
  });
  void delegate(overlay, 'click', '#settings-share-link', (e) => {
    e.preventDefault();
    void triggerShare();
  });
  void delegate(overlay, 'input', '#settings-app-name', (_e, input) => {
    setUi({ appName: asInput(input).value });
    actions.saveAppNameDebounced();
  });
  void delegate(overlay, 'click', '#difftool-register-btn', actions.registerDifftoolAction);
  void delegate(overlay, 'click', '#difftool-unregister-btn', actions.unregisterDifftoolAction);

  // Profile tab
  void delegate(overlay, 'click', '.settings-tag', (_e, tag) => {
    const topic = asEl(tag).dataset.topic;
    if (topic !== undefined) actions.toggleTopic(topic);
  });
  void delegate(overlay, 'click', '#show-more-langs', () => { setUi({ showMoreLangs: true }); });

  // Experimental tab
  void delegate(overlay, 'click', '.settings-platform-control [data-platform]', (_e, btn) => {
    const platform = asEl(btn).dataset.platform;
    if (platform === undefined) return;
    const models = modelsData.models[platform as AIPlatform];
    const defaultModel = models.find(m => m.isDefault);
    const newModel = defaultModel ? defaultModel.id : (models[0]?.id ?? '');
    setUi({ currentPlatform: platform, currentModel: newModel });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-model', (_e, sel) => {
    setUi({ currentModel: asSelect(sel).value });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-local-endpoint', (_e, input) => {
    actions.saveLocalEndpoint(asInput(input).value.trim());
  });
  void delegate(overlay, 'click', '#remove-key', actions.removeKey);
  void delegate(overlay, 'click', '#save-key-btn', actions.saveKey);
  void delegate(overlay, 'keydown', '#settings-key', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter') { ke.preventDefault(); actions.saveKey(); }
  });
  // Apple-FM fallback model picker (shown only when Apple is the platform).
  void delegate(overlay, 'change', '#settings-fallback-platform', (_e, sel) => {
    const platform = asSelect(sel).value;
    let model = '';
    if (platform !== '') {
      const models = modelsData.models[platform as AIPlatform];
      const def = models.find(m => m.isDefault);
      model = def ? def.id : (models[0]?.id ?? '');
    }
    setUi({ fallbackPlatform: platform, fallbackModel: model });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-fallback-model', (_e, sel) => {
    setUi({ fallbackModel: asSelect(sel).value });
    actions.saveConfig();
  });
  void delegate(overlay, 'click', '#remove-fallback-key', actions.removeFallbackKey);
  void delegate(overlay, 'click', '#save-fallback-key-btn', actions.saveFallbackKey);
  void delegate(overlay, 'keydown', '#settings-fallback-key', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter') { ke.preventDefault(); actions.saveFallbackKey(); }
  });
  void delegate(overlay, 'change', '#settings-guided-enabled', (_e, cb) => {
    setUi({ guidedEnabled: asInput(cb).checked });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-channel-enabled', (_e, cb) => {
    const enabled = asInput(cb).checked;
    channelState.enabled = enabled;
    // Disabling tears down the listener, so reflect "not connected" at once; the
    // periodic poll reconciles the connected state once a session attaches.
    if (!enabled) channelState.connected = false;
    void (enabled ? enableChannel() : disableChannel());
    forceRerender();
  });
  void delegate(overlay, 'click', '#channel-copy-btn', (_e, btn) => {
    void navigator.clipboard.writeText('claude --dangerously-load-development-channels server:glassbox-channel');
    const el = asEl(btn);
    el.textContent = 'Copied!';
    setTimeout(() => { el.textContent = 'Copy'; }, TOAST_DURATION_MS);
  });

  // Updates tab
  void delegate(overlay, 'click', '#check-updates-btn', (_e, btn) => {
    void handleCheckUpdates(asButton(btn), overlay);
  });

  // Click outside (on the dimmed overlay background) closes the dialog. Bound
  // directly on the overlay element — it's the modal root, not inside a
  // mount() tree, so a direct listener survives.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
}

async function handleCheckUpdates(btn: HTMLButtonElement, overlay: HTMLElement): Promise<void> {
  const status = overlay.querySelector<HTMLElement>('#check-updates-status');
  if (status === null) return;
  const invoke = getTauriInvoke();
  if (!invoke) return;
  btn.disabled = true;
  btn.textContent = 'Checking...';
  status.textContent = '';
  try {
    const version = (await invoke('check_for_update')) as string | null;
    if (version !== null && version !== '') {
      status.textContent = `Update available: v${version}`;
      showUpdateBanner(version);
    } else {
      status.textContent = 'Your software is up to date.';
    }
  } catch {
    status.textContent = 'Could not check for updates.';
  }
  btn.textContent = 'Check for Updates';
  btn.disabled = false;
}

function renderShell(visible: Tab[], activeTabId: string, ctx: TabContext): SafeHtml {
  return (
    <>
      <div className="settings-header">
        <h3>Settings</h3>
        <button className="settings-close" id="settings-close">&times;</button>
      </div>

      <div className="settings-tabs">
        {visible.map(tab => (
          <button className={`settings-tab${tab.id === activeTabId ? ' active' : ''}`} data-tab={tab.id}>
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="settings-body">
        {visible.map(tab => (
          <div className={`settings-tab-panel${tab.id === activeTabId ? ' active' : ''}`} data-panel={tab.id}>
            {tab.render(ctx)}
          </div>
        ))}
      </div>
    </>
  );
}
