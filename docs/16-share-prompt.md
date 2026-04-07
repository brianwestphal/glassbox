# 16. Share Prompt

Requirements for prompting users to share the application and providing a permanent share button.

## Functional Requirements

### 16.1 Share Prompt Trigger

- The share prompt shall appear when both conditions are met:
  - The user has had Glassbox open for a cumulative total of at least 5 minutes (across all sessions).
  - The current session has been open for at least 1 minute.
- Cumulative open time shall be tracked in `~/.glassbox/config.json`.
- Session time shall be measured from when the client JavaScript initializes.

### 16.2 Share Prompt UI

- The prompt shall appear as a non-modal banner or toast near the top of the UI.
- The prompt shall ask the user if they're enjoying the app and offer to share it.
- The prompt shall include:
  - A "Share" button that opens the OS share sheet.
  - A dismiss action (close button or "No thanks") that hides the prompt.
- Once the user interacts (shares or dismisses), the prompt shall not appear again for 30 days.
- After 30 days, the prompt may appear again using the same trigger criteria.

### 16.3 Share Action

- Sharing shall open the OS-native share sheet with the URL `https://www.npmjs.com/package/glassbox`.
- The share sheet shall use the Web Share API (`navigator.share()`) when available.
- If the Web Share API is not available (e.g., in a standard browser without share support), the share action shall fall back to copying the URL to the clipboard with a brief confirmation toast.

### 16.4 Share Button

- A permanent share button shall be added to the sidebar header toolbar, between the refresh button and the settings gear button.
- On Apple platforms (macOS/iOS), the button shall use the Lucide "share" icon (box with arrow pointing up).
- On all other platforms, the button shall use the Lucide "share-2" icon (nodes with connecting lines).
- Clicking the share button shall trigger the same share action as the prompt (FR-16.3).

### 16.5 Dismiss Persistence

- The dismiss timestamp shall be stored in `~/.glassbox/config.json` under a `sharePrompt` section.
- The cumulative open time shall also be stored there.
- Format: `{ "sharePrompt": { "dismissedAt": <timestamp>, "totalOpenMs": <number> } }`.

## Non-Functional Requirements

### 16.6 Non-Intrusiveness

- The share prompt shall not block or obscure the review workflow.
- The prompt shall be visually subtle — a dismissible banner, not a modal dialog.
- The prompt shall not appear during demo mode.
