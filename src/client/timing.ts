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

/** Duration of "Copied!" / "Sent!" / temporary-state toast affordances. */
export const TOAST_DURATION_MS = 1500;

/** Duration of the go-to-definition jump highlight before it fades. */
export const JUMP_HIGHLIGHT_DURATION_MS = 1500;

/** How often the open Settings dialog re-polls `/api/channel/status` to refresh
 *  the Claude Channel connected/disconnected indicator (doc 17.3). */
export const CHANNEL_STATUS_POLL_MS = 4000;
