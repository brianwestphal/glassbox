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
export interface PluginRegistration {
  renderers?: ContentRenderer[];
  differs?: ContentDiffer[];
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
```

## 6. Worked skeleton — a diagram-source renderer

The first reference plugin ([GB-910](20-ai-review-notes.md)) renders diagram
*source* (Mermaid / Graphviz / PlantUML) to SVG. Sketch:

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
