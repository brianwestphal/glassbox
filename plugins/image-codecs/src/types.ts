/**
 * Standalone copy of the Glassbox content-plugin contract (doc 29 §29.3), the
 * subset this plugin needs — the image-decoder capability (FR-29.19). Kept here
 * so the plugin builds without depending on the Glassbox package and esbuild can
 * bundle it into one self-contained ESM file. Keep in sync with
 * `src/plugins/types.ts` / the developer guide.
 */
export interface ContentMatch {
  extensions?: string[];
  mimeTypes?: string[];
  sniff?: (head: Uint8Array) => boolean;
}

/** A decoded image as RGBA pixels (doc 29 FR-29.19). */
export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA bytes, length = width * height * 4. */
  data: Uint8Array;
}

/** The bytes handed to an image decoder. */
export interface ImageDecodeInput {
  bytes: Uint8Array;
  path: string;
}

/** An image decoder capability: bytes -> RGBA, or null when it can't handle them. */
export interface ImageDecoder {
  name: string;
  match: ContentMatch;
  priority?: number;
  decode(input: ImageDecodeInput): DecodedImage | null | Promise<DecodedImage | null>;
}

/** What a plugin's `activate()` returns — the capabilities it contributes. */
export interface PluginRegistration {
  imageDecoders?: ImageDecoder[];
}

/** Host services handed to a plugin at activation (only the bits this plugin uses). */
export interface PluginContext {
  log(level: 'info' | 'warn' | 'error', message: string): void;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export interface ContentPlugin {
  activate(context: PluginContext): PluginRegistration | void | Promise<PluginRegistration | void>;
  deactivate?(): void | Promise<void>;
}
