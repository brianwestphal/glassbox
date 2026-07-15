/**
 * Standalone copy of the Glassbox content-plugin contract (doc 29 §29.3) — the
 * subset this plugin uses — so it builds without depending on the Glassbox
 * package and esbuild can bundle it into one self-contained ESM file. Keep in
 * sync with `src/plugins/types.ts` / the developer guide.
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
export interface PluginRegistration {
  renderers?: ContentRenderer[];
}
export interface PluginContext {
  log(level: 'info' | 'warn' | 'error', message: string): void;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
export interface ContentPlugin {
  activate(context: PluginContext): PluginRegistration | void | Promise<PluginRegistration | void>;
  deactivate?(): void | Promise<void>;
}
