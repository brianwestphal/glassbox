/**
 * Standalone copy of the Glassbox content-plugin contract (doc 29 §29.3), so
 * this plugin builds without depending on the Glassbox package and esbuild can
 * bundle it into one self-contained ESM file. Keep in sync with
 * `src/plugins/types.ts` / the developer guide.
 */
export interface ContentMatch {
  extensions?: string[];
  mimeTypes?: string[];
  sniff?: (head: Uint8Array) => boolean;
}
export interface RenderInput {
  bytes: Uint8Array;
  text?: string;
  path: string;
  mime?: string;
  side?: 'old' | 'new' | 'single';
}
export interface DiffInput {
  old: RenderInput;
  new: RenderInput;
}
export interface RenderedView {
  svg?: string;
  html?: string;
}
export interface ContentRenderer {
  name: string;
  match: ContentMatch;
  priority?: number;
  render(input: RenderInput): RenderedView | Promise<RenderedView>;
}
export interface ContentDiffer {
  name: string;
  match: ContentMatch;
  priority?: number;
  diff(input: DiffInput): RenderedView | Promise<RenderedView>;
}
export interface PluginRegistration {
  renderers?: ContentRenderer[];
  differs?: ContentDiffer[];
}
export type ConfigLabelColor = 'default' | 'success' | 'error' | 'warning' | 'transient';
export interface PluginContext {
  log(level: 'info' | 'warn' | 'error', message: string): void;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  updateConfigLabel(labelId: string, text: string, color?: ConfigLabelColor): void;
}
export interface ContentPlugin {
  activate(context: PluginContext): PluginRegistration | void | Promise<PluginRegistration | void>;
  deactivate?(): void | Promise<void>;
  onAction?(actionId: string, context: PluginContext): void | Promise<void>;
}
