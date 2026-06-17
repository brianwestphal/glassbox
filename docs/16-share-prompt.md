# 16. Share Prompt

Requirements for prompting users to share the application and providing permanent share access.

## Functional Requirements

### 16.1 Share Prompt Trigger

- The share prompt shall appear when both conditions are met:
  - The user has had Glassbox open for a cumulative total of at least 5 minutes (across all sessions).
  - The current session has been open for at least 1 minute.
- Cumulative open time shall be tracked in `~/.glassbox/config.json`.
- Session time shall be measured from when the client JavaScript initializes.

### 16.2 Share Prompt UI

- The prompt shall appear as a non-modal section in the sidebar (the
  `#sidebar-share` container near the sidebar footer) — not a modal dialog. It is
  the single share banner; there is no separate immediate-on-launch banner.
- The prompt shall be headed "Love Glassbox?" and offer:
  - A **Share** button that performs the share action (FR-16.3).
  - A **Sponsor** link that opens the project's GitHub Sponsors page. In the
    Tauri desktop shell the link is routed through the OS default browser (the
    webview never reaches a real browser via `target="_blank"`); in a plain
    browser the anchor opens normally.
  - A dismiss action (the **×** button) that hides the prompt.
- Once the user interacts (shares or dismisses), the prompt shall not appear
  again for 30 days.
- After 30 days, the prompt may appear again using the same trigger criteria.

### 16.3 Share Action

- Sharing shall open the OS-native share sheet with the URL `https://www.npmjs.com/package/glassbox`.
- The share sheet shall use the Web Share API (`navigator.share()`) when available.
- If the Web Share API is not available (e.g., in a standard browser without share support), the share action shall fall back to copying the URL to the clipboard with a brief confirmation toast.

### 16.4 Permanent Share Access

Independent of the time-gated prompt (FR-16.1) and its 30-day dismiss cooldown,
**Settings → General** shall include a permanent share link ("Know someone who'd
love this? **Share Glassbox**"). Clicking it shall trigger the same share action
as the prompt (FR-16.3). This is the always-available entry point and is never
dismissed — so a user who dismissed the prompt (or hasn't hit its time threshold)
can still share at any time.

> **Design note.** An earlier revision of this requirement specified a permanent
> icon-only share button in the sidebar header toolbar (between the refresh and
> settings-gear buttons), with platform-specific Lucide "share" / "share-2"
> icons. That toolbar button was never built and was intentionally dropped: the
> Settings link above provides the permanent always-available access it was meant
> to give, so the toolbar button was redundant. The `IconShareApple` /
> `IconShareGeneric` components in `src/icons.tsx` are the leftover (currently
> unused) icons from that design.

### 16.5 Dismiss Persistence

- The dismiss timestamp shall be stored in `~/.glassbox/config.json` under a `sharePrompt` section.
- The cumulative open time shall also be stored there.
- Format: `{ "sharePrompt": { "dismissedAt": <timestamp>, "totalOpenMs": <number> } }`.

## Non-Functional Requirements

### 16.6 Non-Intrusiveness

- The share prompt shall not block or obscure the review workflow.
- The prompt shall be visually subtle — a dismissible banner, not a modal dialog.
- The prompt shall not appear during demo mode.
