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

/** What a plugin's `activate()` returns — the capabilities it contributes. */
export interface PluginRegistration {
  renderers?: ContentRenderer[];
  differs?: ContentDiffer[];
}

/**
 * A dynamic config-layout label's semantic tone (doc 29 FR-29.18). The plugin
 * picks the tone; the host maps it to the actual UI color so labels stay
 * consistent across plugins.
 */
export type ConfigLabelColor = 'default' | 'success' | 'error' | 'warning' | 'transient';

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
   * Handle a `button` action declared in the manifest `configLayout` (doc 29
   * FR-29.18). Invoked with the same `PluginContext` passed to `activate`, so it
   * can read settings and call `updateConfigLabel` to reflect status in the UI.
   */
  onAction?(actionId: string, context: PluginContext): void | Promise<void>;
}
