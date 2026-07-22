/**
 * Centralised timing constants for client-side UI.
 *
 * Anything tunable (poll intervals, debounce delays, toast durations, jump
 * highlight fade) lives here so a single import map controls every
 * setTimeout/setInterval that affects perceived UX.
 */

/** How often the AI sort modes poll `/api/ai/analysis/:type` for progress / completion. */
export const ANALYSIS_POLL_INTERVAL_MS = 3000;

/** Debounce for the AI config save when platform/model/guided settings change. */
export const SETTINGS_CONFIG_DEBOUNCE_MS = 300;

/** Debounce for the per-project `appName` save in Settings → General. */
export const SETTINGS_APP_NAME_DEBOUNCE_MS = 500;

/** Duration of every transient toast / temporary-state affordance ("Copied!",
 *  the app toast, the share copy confirmation, the settings error flash).
 *  Previously split 1500/2000 across three implementations — reconciled to one
 *  constant (GB-1087). */
export const TOAST_DURATION_MS = 2000;

/** Delay before the completion modal closes itself after "Send to Claude". */
export const SEND_TO_CLAUDE_CLOSE_MS = 1000;

/** Debounce for persisting the diff scroll position while scrolling. */
export const SCROLL_SAVE_DEBOUNCE_MS = 300;

/** Back-off schedule for the Tauri update-banner status polls after launch. */
export const UPDATE_POLL_DELAYS_MS = [0, 3000, 10000] as const;

/** How often the difftool sidebar polls the session status (doc 19). */
export const DIFFTOOL_SESSION_POLL_MS = 1000;

/** Debounce for the sidebar file-filter input. */
export const FILTER_DEBOUNCE_MS = 150;

/** Duration of the go-to-definition jump highlight before it fades. */
export const JUMP_HIGHLIGHT_DURATION_MS = 1500;

/** How often the open Settings dialog re-polls `/api/channel/status` to refresh
 *  the Claude Channel connected/disconnected indicator (doc 17.3). */
export const CHANNEL_STATUS_POLL_MS = 4000;
