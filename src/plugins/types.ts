/**
 * The content-plugin contract (doc 29 §29.3). A plugin declares the content
 * types it handles and provides a `renderer` (single file/blob → view) and/or a
 * `differ` (old vs new → diff view). One API serves both the file diff viewer
 * and review-note artifacts (doc 20).
 *
 * These types are the *host* side of the contract. A third-party plugin can be
 * built against a standalone copy of them (the developer guide, GB-1041) so it
 * never has to depend on the Glassbox package and can esbuild-bundle its own
 * dependencies (doc 29 FR-29.5).
 *
 * Pure type declarations — no Node deps — so both the server loader and any
 * pure matcher can import them.
 */

/**
 * How a plugin declares the content it handles. A file/artifact matches when
 * ANY declared axis matches; specificity for tie-breaking is sniff, then mime,
 * then extension (doc 29 FR-29.8).
 */
export interface ContentMatch {
  /** File extensions, incl. the leading dot, e.g. `['.mmd', '.mermaid']`. Compared case-insensitively. */
  extensions?: string[];
  /** MIME types, e.g. `['text/vnd.mermaid']`. */
  mimeTypes?: string[];
  /** A predicate over the leading bytes of the content (a "content sniff"). */
  sniff?: (head: Uint8Array) => boolean;
}

/** The content handed to a renderer. */
export interface RenderInput {
  /** Raw content bytes. */
  bytes: Uint8Array;
  /** Decoded UTF-8 text, when the content is textual (absent for binary). */
  text?: string;
  /** Display path / URI — used for extension matching and labeling. */
  path: string;
  /** MIME type, when known. */
  mime?: string;
  /** Which side this content is, for a single-file render. */
  side?: 'old' | 'new' | 'single';
}

/** The two sides handed to a differ. */
export interface DiffInput {
  old: RenderInput;
  new: RenderInput;
}

/**
 * A plugin's rendered output. Exactly one of `svg` / `html` should be set. `svg`
 * is delivered inertly by the host (via an `<img>` data URI — no script
 * execution, no external loads); `html` is inserted as trusted markup, so a
 * plugin MUST return inert HTML with respect to the content it rendered
 * (doc 29 NFR-29.2).
 */
export interface RenderedView {
  svg?: string;
  html?: string;
}

export interface ContentRenderer {
  /** Human-readable name (shown in the management UI / logs). */
  name: string;
  match: ContentMatch;
  /** Higher wins when several renderers match; default 0. */
  priority?: number;
  render(input: RenderInput): RenderedView | Promise<RenderedView>;
}

export interface ContentDiffer {
  name: string;
  match: ContentMatch;
  priority?: number;
  diff(input: DiffInput): RenderedView | Promise<RenderedView>;
}

/**
 * A review, in the stable plugin-facing shape handed to lifecycle hooks (doc 31
 * FR-31.2). A curated subset of the DB row so the contract doesn't leak schema
 * details.
 */
export interface ReviewHookInfo {
  id: string;
  repoPath: string;
  repoName: string;
  /** Review mode string, e.g. `uncommitted` / `branch` / `commit`. */
  mode: string;
  status: string;
}

/** An annotation, in the stable plugin-facing shape (doc 31 FR-31.2). */
export interface AnnotationHookInfo {
  id: string;
  filePath: string;
  /** 1-based line, or 0 for an image-level annotation (doc 23). */
  lineNumber: number;
  side: string;
  category: string;
  content: string;
}

/**
 * Review lifecycle hooks (doc 31) — a general (non-content) capability. Both are
 * invoked fail-soft and asynchronously; a throwing or slow hook never blocks the
 * review. `onReviewCreated` fires once the plugin subsystem is loaded for the
 * review; `onReviewCompleted` fires after the review is marked complete and the
 * `.glassbox/latest-review.md` export is written (`exportPath`).
 */
export interface ReviewHooks {
  // Declared as function-property types (not method signatures) so the host can
  // safely extract + call them as plain callbacks (no `this` binding).
  onReviewCreated?: (review: ReviewHookInfo, context: PluginContext) => void | Promise<void>;
  onReviewCompleted?: (
    review: ReviewHookInfo,
    annotations: AnnotationHookInfo[],
    exportPath: string,
    context: PluginContext,
  ) => void | Promise<void>;
}

/**
 * A decoded image as RGBA pixels (doc 29 imageDecoders capability). The shape the
 * perceptual diff (doc 26 P2) consumes: a plugin decodes a format core can't
 * (WebP/AVIF/…) so those ground-truth pairs become scorable.
 */
export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA bytes, length = width * height * 4. */
  data: Uint8Array;
}

/** The bytes handed to an image decoder. */
export interface ImageDecodeInput {
  /** Raw image bytes. */
  bytes: Uint8Array;
  /** Display path / URI — used for extension matching and labeling. */
  path: string;
}

/**
 * An image decoder capability (doc 29): bytes → RGBA. Additive — independent of
 * renderer/differ. Dispatched by the same (priority, specificity) match as a
 * renderer. `decode` returns `null` for bytes it can't handle (fail-soft); it may
 * be async (WASM codecs load asynchronously).
 */
export interface ImageDecoder {
  /** Human-readable name (shown in logs). */
  name: string;
  match: ContentMatch;
  /** Higher wins when several decoders match; default 0. */
  priority?: number;
  decode(input: ImageDecodeInput): DecodedImage | null | Promise<DecodedImage | null>;
}

/** What a plugin's `activate()` returns — the capabilities it contributes. */
export interface PluginRegistration {
  renderers?: ContentRenderer[];
  differs?: ContentDiffer[];
  /** Image decoders (bytes → RGBA) for the perceptual diff (doc 29 / doc 26). */
  imageDecoders?: ImageDecoder[];
  /** Review lifecycle hooks (doc 31). A hooks-only registration is valid. */
  reviewHooks?: ReviewHooks;
}

/**
 * A dynamic config-layout label's semantic tone (doc 29 FR-29.18). The plugin
 * picks the tone; the host maps it to the actual UI color so labels stay
 * consistent across plugins.
 */
export type ConfigLabelColor = 'default' | 'success' | 'error' | 'warning' | 'transient';

/**
 * Where a plugin UI element renders in the host chrome (doc 30 FR-30.2).
 * `header` = the main-content top bar; `diff-toolbar` = the bottom diff toolbar;
 * `sidebar-footer` = below the Complete/Reopen controls.
 */
export type PluginUILocation = 'header' | 'diff-toolbar' | 'sidebar-footer';

/** Fields shared by every plugin UI element (doc 30). */
interface PluginUIBase {
  /** Unique within the plugin. */
  id: string;
  location: PluginUILocation;
}

/** A clickable button that triggers the plugin's `onAction` (doc 30 FR-30.3). */
export interface PluginUIButton extends PluginUIBase {
  type: 'button';
  label?: string;
  /** Inline SVG string (rendered inertly; the plugin ships no DOM). */
  icon?: string;
  /** Tooltip. */
  title?: string;
  style?: 'default' | 'primary' | 'danger';
  /** Action id passed to `onAction` on click. */
  action: string;
}

/** A link that opens an external URL in a new tab (doc 30 FR-30.3). */
export interface PluginUILink extends PluginUIBase {
  type: 'link';
  url: string;
  label?: string;
  icon?: string;
  title?: string;
}

/**
 * A two-state toggle button (doc 30). **Declared but not yet rendered** by the
 * host client — tracked as a follow-up (stateful controls need client-side
 * selection state + `stateKey` persistence). Kept in the contract so plugins can
 * author against the full surface.
 */
export interface PluginUIToggle extends PluginUIBase {
  type: 'toggle';
  on: { label?: string; icon?: string; title?: string; style?: string };
  off: { label?: string; icon?: string; title?: string; style?: string };
  action: string;
  /** Setting key the host reads/writes for on/off persistence. */
  stateKey?: string;
}

/** A labeled switch (doc 30). Declared but not yet rendered (see `PluginUIToggle`). */
export interface PluginUISwitch extends PluginUIBase {
  type: 'switch';
  onLabel: string;
  offLabel: string;
  action: string;
  stateKey?: string;
}

/** A segmented control (doc 30). Declared but not yet rendered (see `PluginUIToggle`). */
export interface PluginUISegmentedControl extends PluginUIBase {
  type: 'segmented-control';
  segments: { id: string; label?: string; icon?: string; title?: string }[];
  selectionMode: 'zero-or-one' | 'exactly-one' | 'zero-or-more' | 'one-or-more';
  action: string;
  stateKey?: string;
}

/** The union of plugin UI elements (doc 30 FR-30.3). */
export type PluginUIElement =
  | PluginUIButton
  | PluginUILink
  | PluginUIToggle
  | PluginUISwitch
  | PluginUISegmentedControl;

/**
 * What a plugin `onAction` may return (doc 30 FR-30.5). Opaque except `message`,
 * which the host surfaces as a transient toast. `void` (the common case) means
 * "no client feedback".
 */
export interface UIActionResult {
  message?: string;
}

/** Host services handed to a plugin at activation. */
export interface PluginContext {
  /** Scoped logger; messages are prefixed with the plugin id. */
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Read a persisted per-plugin setting (secrets keychain-backed; GB-1040). */
  getSetting(key: string): Promise<string | null>;
  /** Persist a per-plugin setting (GB-1040). */
  setSetting(key: string, value: string): Promise<void>;
  /**
   * Update a `label` item in the plugin's manifest `configLayout` at runtime
   * (doc 29 FR-29.18) — e.g. show "Connected" after a `test` button action. The
   * Settings → Plugins tab reflects the new text/color the next time the list
   * refreshes (which an action triggers). No-op for an unknown `labelId`.
   */
  updateConfigLabel(labelId: string, text: string, color?: ConfigLabelColor): void;
  /**
   * Register interactive UI elements at predefined host locations (doc 30
   * FR-30.4). Called during `activate`; replaces this plugin's previously
   * registered set. A click/interaction round-trips to `onAction`.
   */
  registerUI(elements: PluginUIElement[]): void;
}

/**
 * The module contract a plugin's entry point exports — as a `default` object or
 * as named `activate` / `onAction` exports. `activate` returns its registration
 * (renderers / differs), or nothing for a no-op plugin (doc 29 FR-29.11).
 */
export interface ContentPlugin {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- activate may return nothing (void) or a registration, sync or async
  activate(context: PluginContext): PluginRegistration | void | Promise<PluginRegistration | void>;
  deactivate?(): void | Promise<void>;
  /**
   * Handle an action from a config-layout `button` (doc 29 FR-29.18) or a
   * registered UI element (doc 30 FR-30.5). Invoked with the same `PluginContext`
   * passed to `activate`, so it can read settings and call `updateConfigLabel`.
   * For a **stateful** control (toggle / switch / segmented-control, doc 30
   * FR-30.3) `value` carries the new state the host has already persisted to the
   * element's `stateKey` (a `'true'`/`'false'` string for toggle/switch, a
   * segment id or a JSON array for a segmented-control); it is absent for a plain
   * button. May return a `UIActionResult` (e.g. a `message` toast) or nothing.
   */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- onAction may return nothing (void) or a result, sync or async
  onAction?(actionId: string, context: PluginContext, value?: string): void | UIActionResult | Promise<void | UIActionResult>;
}
