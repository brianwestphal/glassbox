# PlantUML plugin for Glassbox

Renders PlantUML `.puml` / `.plantuml` / `.pu` / `.iuml` source to SVG in the
Glassbox diff viewer and in review-note artifacts (doc 29 content plugins).

## Why this one is different

PlantUML is a **Java** application — there is no pure-JS or WASM engine (unlike
the Graphviz plugin's `@viz-js/viz`). So this plugin renders by spawning a
**local** `java -jar plantuml.jar -pipe -tsvg` subprocess. That keeps rendering
**offline / local-first** (nothing is sent to `plantuml.com`), but it means the
plugin has **system requirements** and is therefore **separately installable** —
it is *not* auto-installed with Glassbox (`autoInstall: false`), so nobody is
forced to have Java.

## Requirements

- A **JRE** (Java 8+) on your `PATH`.
- **`plantuml.jar`** in the plugin's install directory (fetched by the setup
  helper; ~11 MB, GPL — not committed to this repo or shipped in the app bundle).

## Install

```bash
npm run build:plugins            # builds dist/plugins/plantuml/
node plugins/plantuml/setup.mjs  # checks Java, installs the plugin, fetches plantuml.jar
```

`setup.mjs` installs into `~/.glassbox/plugins/plantuml/` (honoring
`GLASSBOX_CONFIG_DIR`) and downloads the jar there. Override the jar with
`PLANTUML_VERSION=<maven-version>` or `PLANTUML_JAR_URL=<url>`, or drop your own
`plantuml.jar` into that directory. Restart Glassbox afterward.

## Fallback

If Java or the jar is missing, or a diagram fails to render, the renderer returns
an empty view and Glassbox shows its normal **code-block** view of the `.puml`
source — so the file is always readable, plugin or not.
