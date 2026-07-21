# Building a Glassbox Content Plugin

Glassbox keeps its core lean and local-first: heavy, format-specific renderers
live *outside* the base install and are added opt-in as **content plugins**. A
plugin registers a **renderer** (a single file/blob → a view) and/or a
**differ** (old vs new → a diff view) for the content types it handles — a
diagram source, a notebook, a CAD file, a rich log, a proprietary format. Glassbox
uses them in two places: the file diff viewer and AI review-note artifacts
(doc [20](20-ai-review-notes.md)).

This guide is for someone building such a plugin. The design and requirements
live in [doc 29](29-content-plugins.md); this is the practical how-to.

> **Status.** The plugin **core** (loader, contract, dispatcher, the review-note
> **artifact** integration) has shipped. The file-diff-viewer integration
> (GB-1042), desktop bundling of plugins (GB-1039), and the Settings management
> UI (GB-1040) are in progress — until they land, install a plugin by dropping it
> into `~/.glassbox/plugins/` (below) and run Glassbox from the CLI / a dev build.

## 1. The shape of a plugin

A plugin is a directory with a **manifest** and a single **entry module**:

```
my-plugin/
├── manifest.json     # or a package.json with a "glassbox" field
└── index.js          # the entry: a self-contained ESM module
```

The entry module is loaded by dynamic `import()` and must be **self-contained**:
bundle your dependencies into it (esbuild `--bundle --format=esm --platform=node`).
Glassbox resolves nothing against its own `node_modules`, which is exactly what
lets your plugin load unchanged in a global npm install *and* inside the packaged
desktop app (whose bundled `node_modules` is frozen). Import only **types** from
Glassbox (they erase at build time) — copy the standalone `types.ts` in §5 so you
don't depend on the Glassbox package at all.

## 2. The manifest

`manifest.json`:

```json
{
  "id": "my-diagram-plugin",
  "name": "My Diagram Plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "description": "Renders Mermaid diagrams to SVG.",
  "author": "you",
  "contentTypes": [
    { "extensions": [".mmd", ".mermaid"], "mimeTypes": ["text/vnd.mermaid"] }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Stable, unique plugin id. |
| `name` | yes | Human-readable, shown in the (upcoming) management UI. |
| `version` | yes | Semver string. |
| `entry` | no | Entry module relative to the plugin dir. Defaults to `index.js`. |
| `description`, `author` | no | Informational. |
| `contentTypes` | no | Informational for the UI. The **authoritative** match lives in the `match` on your registered renderer/differ (§3). |

The manifest is validated by a zod schema — this is the single trust boundary.
An invalid manifest means your plugin is skipped (fail-soft), never a crash. You
may add extra keys; only the fields above are read.

Alternatively, put the same fields under a `"glassbox"` key in `package.json`
(`id`/`version`/`entry` fall back to `name`/`version`/`main`).

## 3. The entry module

Export a `default` object (or a named `activate`) implementing `ContentPlugin`.
`activate(context)` returns the renderers/differs you contribute:

```js
/** @type {import('./types.js').ContentPlugin} */
export default {
  activate(context) {
    context.log('info', 'my-diagram-plugin activated');
    return {
      renderers: [
        {
          name: 'mermaid',
          match: { extensions: ['.mmd', '.mermaid'] },
          priority: 0,
          render(input) {
            const svg = renderMermaidToSvg(input.text ?? '');  // your bundled renderer
            return { svg };  // inert SVG — see §4
          },
        },
      ],
    };
  },
};
```

- **`match`** declares what content you handle — by `extensions` (incl. the dot,
  case-insensitive), `mimeTypes`, and/or a `sniff(head)` predicate over the
  leading bytes. When several plugins match, the dispatcher picks the highest
  `(priority, specificity)`, where a content sniff is more specific than a MIME
  match, which beats an extension match.
- **`render(input)`** receives `{ bytes, text?, path, mime?, side? }` and returns
  a `RenderedView`. It may be sync or async.
- A **differ** is the same but with `diff({ old, new })` — use it when a *modified*
  file should be diffed by your plugin (e.g. two diagram versions side by side)
  rather than as a text diff.
- Return **nothing** from `activate` for a no-op plugin (e.g. one that only logs).
- A renderer/differ that throws, or returns an empty view, is treated as "no
  match" — Glassbox falls back to its built-in view. Nothing you do can crash the
  host.

## 4. The safe-output contract

Return **inert** output — it renders over content Glassbox does not trust:

- **`svg`** — return SVG *source*. Glassbox displays it via an `<img>` (a data
  URI), which neither executes scripts nor loads external resources. This is the
  recommended, safest path.
- **`html`** — returned as trusted markup. You are responsible for making it
  inert: no `<script>`, no external resource loads, no network. Prefer `svg`
  unless you specifically need HTML.

Everything must be **offline** — no CDN, no remote fetch. Bundle any assets.

## 5. Standalone `types.ts` (copy-paste)

Copy this into your plugin so you never depend on the Glassbox package. It is the
exact host contract (doc 29 §29.3); build against it and esbuild-bundle.

```ts
export interface ContentMatch {
  extensions?: string[];               // incl. the dot, case-insensitive
  mimeTypes?: string[];
  sniff?: (head: Uint8Array) => boolean;
}
export interface RenderInput {
  bytes: Uint8Array;
  text?: string;                       // decoded UTF-8 when textual
  path: string;                        // display path / URI
  mime?: string;
  side?: 'old' | 'new' | 'single';
}
export interface DiffInput { old: RenderInput; new: RenderInput; }
export interface RenderedView { svg?: string; html?: string; }  // exactly one
export interface ContentRenderer {
  name: string;
  match: ContentMatch;
  priority?: number;                   // higher wins; default 0
  render(input: RenderInput): RenderedView | Promise<RenderedView>;
}
export interface ContentDiffer {
  name: string;
  match: ContentMatch;
  priority?: number;
  diff(input: DiffInput): RenderedView | Promise<RenderedView>;
}
// Review lifecycle hooks (doc 31). A hooks-only registration is valid.
export interface ReviewHookInfo { id: string; repoPath: string; repoName: string; mode: string; status: string }
export interface AnnotationHookInfo { id: string; filePath: string; lineNumber: number; side: string; category: string; content: string }
export interface ReviewHooks {
  onReviewCreated?: (review: ReviewHookInfo, context: PluginContext) => void | Promise<void>;
  onReviewCompleted?: (review: ReviewHookInfo, annotations: AnnotationHookInfo[], exportPath: string, context: PluginContext) => void | Promise<void>;
}
// Image-decoder capability (doc 29 FR-29.19): bytes → RGBA, for the perceptual diff.
export interface DecodedImage { width: number; height: number; data: Uint8Array }  // RGBA, length = w*h*4
export interface ImageDecodeInput { bytes: Uint8Array; path: string }
export interface ImageDecoder {
  name: string;
  match: ContentMatch;
  priority?: number;                     // higher wins; default 0
  decode(input: ImageDecodeInput): DecodedImage | null | Promise<DecodedImage | null>;  // null = can't handle
}
export interface PluginRegistration {
  renderers?: ContentRenderer[];
  differs?: ContentDiffer[];
  imageDecoders?: ImageDecoder[];
  reviewHooks?: ReviewHooks;
}
export type ConfigLabelColor = 'default' | 'success' | 'error' | 'warning' | 'transient';
// Plugin UI extensions (doc 30). Only `button` and `link` render today.
export type PluginUILocation = 'header' | 'diff-toolbar' | 'sidebar-footer';
export interface PluginUIButton {
  type: 'button'; id: string; location: PluginUILocation;
  label?: string; icon?: string; title?: string;   // icon = inline SVG string
  style?: 'default' | 'primary' | 'danger'; action: string;
}
export interface PluginUILink {
  type: 'link'; id: string; location: PluginUILocation;
  url: string; label?: string; icon?: string; title?: string;
}
export type PluginUIElement = PluginUIButton | PluginUILink;  // (+ toggle/switch/segmented-control, declared not rendered)
export interface UIActionResult { message?: string }         // onAction may return a toast message
export interface PluginContext {
  log(level: 'info' | 'warn' | 'error', message: string): void;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  updateConfigLabel(labelId: string, text: string, color?: ConfigLabelColor): void;  // config-layout status
  registerUI(elements: PluginUIElement[]): void;   // main-app UI extensions (doc 30)
}
export interface ContentPlugin {
  activate(context: PluginContext): PluginRegistration | void | Promise<PluginRegistration | void>;
  deactivate?(): void | Promise<void>;
  // Handles config-layout buttons (doc 29) + UI-element actions (doc 30); may return a toast message.
  onAction?(actionId: string, context: PluginContext): void | UIActionResult | Promise<void | UIActionResult>;
}
```

### Config layout (optional)

By default the Settings → Plugins tab renders your `preferences` as a flat list.
A manifest **`configLayout`** array lets you arrange them into collapsible
**groups**, add **dividers** / **spacers**, show dynamic **status labels**, and
add **buttons** that invoke your `onAction` handler. Item types:

```jsonc
"configLayout": [
  { "type": "group", "title": "Rendering", "collapsed": false, "items": [
    { "type": "preference", "key": "engine" },   // references a declared preference
    { "type": "spacer" },
    { "type": "divider" },
    { "type": "label", "id": "status", "text": "Not tested", "color": "transient" },
    { "type": "button", "id": "test", "label": "Test", "action": "test_renderer", "style": "primary" }
  ]}
]
```

A `button` click calls `onAction(action, context)`. Inside it, call
`context.updateConfigLabel(labelId, text, color?)` to reflect status back into
the matching `label` (colors: `default` / `success` / `error` / `warning` /
`transient`). The `plugins/graphviz/` reference plugin uses exactly this — a
"Test renderer" button that renders a trivial graph and reports OK/failure.

### Review lifecycle hooks (optional, doc 31)

A plugin can react to the **review lifecycle** — independent of file type — by
returning `reviewHooks` from `activate`. Both hooks are fail-soft (a throw never
blocks the review) and receive the plugin's context. Example — write a JSON
summary next to the export when a review completes:

```ts
const plugin: ContentPlugin = {
  activate(ctx) {
    return {
      reviewHooks: {
        onReviewCreated(review) {
          ctx.log('info', `review started: ${review.repoName} (${review.mode})`);
        },
        onReviewCompleted(review, annotations, exportPath) {
          const byCategory: Record<string, number> = {};
          for (const a of annotations) byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
          const summaryPath = exportPath.replace(/\.md$/, '.summary.json');
          require('node:fs').writeFileSync(summaryPath, JSON.stringify({ review, total: annotations.length, byCategory }, null, 2));
        },
      },
    };
  },
};
```

`onReviewCreated` fires once the plugin subsystem has loaded for the review;
`onReviewCompleted` fires after the review is completed and `latest-review.md` is
written, with all annotations + the export path. **Note:** a hook that makes
**outbound network calls** (posting to an issue tracker, notifying a chat) shifts
Glassbox's default local-first posture — that's a deliberate consequence of
installing such a plugin (doc 29 §29.6). Keep hooks offline unless the plugin's
purpose is an explicit external integration.

### Image decoders (optional, doc 29 FR-29.19)

A plugin can teach Glassbox to decode an **image format core can't** — WebP, AVIF,
etc. — so ground-truth image comparisons ([doc 26](26-ground-truth-comparison.md))
in that format get a **perceptual difference score** (and most-different-first
sorting) instead of "no score". Return `imageDecoders` from `activate`; each
decodes bytes → RGBA:

```ts
const plugin: ContentPlugin = {
  activate(ctx) {
    return {
      imageDecoders: [{
        name: 'webp',
        match: { extensions: ['.webp'], mimeTypes: ['image/webp'] },
        async decode({ bytes }) {
          try {
            const { data, width, height } = await decodeWebpToRgba(bytes);  // your bundled WASM codec
            return { width, height, data };   // data = RGBA, length = width*height*4
          } catch { return null; }            // null → Glassbox leaves the pair unscored
        },
      }],
    };
  },
};
```

Core decodes PNG/JPEG itself; your decoder is consulted only for formats it can't.
A decoder that returns `null` or throws is fail-soft — the pair stays "no score",
nothing crashes. WASM codecs (`@jsquash/webp`, `@jsquash/avif`) esbuild-bundle into
your plugin exactly like a WASM renderer. The `plugins/image-codecs/` reference
plugin (GB-1064) does exactly this.

## 6. Worked skeleton — a diagram-source renderer

The first reference plugin — **Graphviz** — ships in-repo at `plugins/graphviz/`
(source `plugins/graphviz/src/index.ts`), rendering `.dot`/`.gv` to SVG
server-side via `@viz-js/viz` (WebAssembly Graphviz, no DOM). Build it with
`npm run build:plugins`. It's the concrete example of everything above; the
sketch below is the shape:

```ts
import type { ContentPlugin } from './types.js';

const plugin: ContentPlugin = {
  activate(ctx) {
    return {
      renderers: [{
        name: 'diagram',
        match: {
          extensions: ['.mmd', '.mermaid', '.dot', '.gv', '.puml'],
          // Or sniff: (b) => new TextDecoder().decode(b.slice(0, 16)).startsWith('graph ')
        },
        async render(input) {
          try {
            const svg = await renderToSvg(input.path, input.text ?? '');  // bundled renderer
            return { svg };
          } catch (e) {
            ctx.log('warn', `render failed: ${String(e)}`);
            return {};  // empty view → Glassbox falls back to the code block
          }
        },
      }],
    };
  },
};
export default plugin;
```

Build it into a single `index.js` (esbuild `--bundle --format=esm
--platform=node`), drop the folder into `~/.glassbox/plugins/`, and a `.mmd`
review-note artifact renders as a diagram instead of a code block. When the plugin
isn't installed or a syntax isn't supported, the committed source still shows as a
code block — nothing regresses.

## 7. Install & trust

- **Install (today):** put the built plugin directory under `~/.glassbox/plugins/`
  — one directory per plugin (a symlink to your source tree works too). Restart
  Glassbox. A Settings *Plugins* tab and an "install from disk" picker are coming
  (GB-1040); desktop apps will bundle official plugins and auto-install them
  (GB-1039).
- **Trust model:** plugins run **in-process, server-side, at the app's own trust
  level** — there is no sandbox. Installing a plugin is a deliberate act, the same
  trust decision as adding an npm dependency (doc [14](14-security.md),
  [doc 29](29-content-plugins.md) §29.6). Only install plugins you trust.
- **Enablement:** a plugin is enabled **per project** (opt-in, default off) once
  the management UI ships; the code is installed globally.

## 8. See also

- [doc 29 — Content Plugins](29-content-plugins.md) — the full contract,
  discovery, trust model, and requirements.
- [doc 20 — AI review notes](20-ai-review-notes.md) — artifacts, the first
  integration point a renderer serves.
- [doc 14 — Security](14-security.md) — the threat model the trust decision
  rests on.
