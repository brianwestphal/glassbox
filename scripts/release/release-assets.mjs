// Single source of truth for the GitHub Releases download summary and the
// user-facing renaming of desktop installer assets.
//
// The release-desktop.yml workflow consumes this module in two places:
//   1. the `Extract release notes` step calls `download-section` to build the
//      "## Download" block that links each platform to its installer, and
//   2. the `Rename user-facing download assets` step imports `friendlyName`
//      to rename the raw Tauri bundle filenames.
//
// Keeping both halves here (rather than duplicated inline in YAML) is what
// stops the bug class this guards against: a download link in the release
// notes that 404s because it doesn't match the filename actually shipped.
// `tests/unit/scripts/release-assets.test.ts` pins that the links and the
// renamed asset names always agree.
//
// Plain ESM (.mjs) on purpose: the create-release job runs it with the
// runner's preinstalled `node` without an npm install / tsx step.

// Only .dmg files are safe to rename. The Tauri updater's latest.json
// references the .exe / .msi / .deb / .AppImage / .rpm assets by their
// original filenames; macOS updates use the .app.tar.gz instead, so the
// .dmg can be given a human-friendly name without breaking auto-update.
//
// Each rule rewrites the whole filename so the result uses dash separators
// throughout (`Glassbox-<version>-macOS-Apple-Silicon.dmg`) rather than the
// mixed `Glassbox_<version>_aarch64.dmg` Tauri emits.
const RENAME_RULES = [
  { pattern: /^Glassbox_(.+?)_aarch64\.dmg$/, replacement: 'Glassbox-$1-macOS-Apple-Silicon.dmg' },
  { pattern: /^Glassbox_(.+?)_x64\.dmg$/, replacement: 'Glassbox-$1-macOS-Intel.dmg' },
];

/**
 * Map a raw Tauri bundle filename to its user-facing name. Returns the input
 * unchanged when no rename rule applies (Linux / Windows installers and the
 * updater sidecar assets keep their original names).
 * @param {string} name
 * @returns {string}
 */
export function friendlyName(name) {
  for (const { pattern, replacement } of RENAME_RULES) {
    if (pattern.test(name)) return name.replace(pattern, replacement);
  }
  return name;
}

/**
 * The raw filenames Tauri produces for a given version, before renaming.
 * @param {string} version e.g. "0.12.0"
 */
function rawBundleNames(version) {
  return {
    macArm: `Glassbox_${version}_aarch64.dmg`,
    macIntel: `Glassbox_${version}_x64.dmg`,
    linuxDeb: `Glassbox_${version}_amd64.deb`,
    linuxAppImage: `Glassbox_${version}_amd64.AppImage`,
    linuxRpm: `Glassbox-${version}-1.x86_64.rpm`,
    winExe: `Glassbox_${version}_x64-setup.exe`,
    winMsi: `Glassbox_${version}_x64_en-US.msi`,
  };
}

/**
 * Every filename that is actually published to the release, with renames
 * applied. The download links must each be a member of this set.
 * @param {string} version
 * @returns {string[]}
 */
export function shippedAssetNames(version) {
  return Object.values(rawBundleNames(version)).map(friendlyName);
}

/**
 * The download entries linked from the release body, grouped by platform.
 * The `file` of each entry is run through friendlyName so it always matches
 * the shipped asset name.
 * @param {string} version
 */
export function downloadEntries(version) {
  const raw = rawBundleNames(version);
  return {
    macOS: [
      { file: friendlyName(raw.macArm), label: 'Apple Silicon (.dmg)', note: 'M-series Macs' },
      { file: friendlyName(raw.macIntel), label: 'Intel (.dmg)', note: 'older Macs' },
    ],
    Linux: [
      { file: friendlyName(raw.linuxDeb), label: 'Debian / Ubuntu (.deb)', note: '' },
      { file: friendlyName(raw.linuxAppImage), label: 'AppImage', note: 'runs on most distros, no install needed' },
      { file: friendlyName(raw.linuxRpm), label: 'Red Hat / Fedora (.rpm)', note: '' },
    ],
    Windows: [
      { file: friendlyName(raw.winExe), label: 'Installer (.exe)', note: '' },
      { file: friendlyName(raw.winMsi), label: 'MSI', note: 'for managed-deployment environments' },
    ],
  };
}

/**
 * Build the "## Download" markdown block linking each installer to its asset.
 * @param {string} version e.g. "0.12.0"
 * @param {string} repo e.g. "brianwestphal/glassbox"
 * @param {string} tag e.g. "v0.12.0"
 */
export function downloadSection(version, repo, tag) {
  const base = `https://github.com/${repo}/releases/download/${tag}`;
  const groups = downloadEntries(version);
  const lines = ['## Download', ''];
  for (const [platform, entries] of Object.entries(groups)) {
    lines.push(`### ${platform}`);
    for (const { file, label, note } of entries) {
      const suffix = note ? ` — ${note}` : '';
      lines.push(`- [${label}](${base}/${file})${suffix}`);
    }
    lines.push('');
  }
  lines.push(
    "Not sure which to pick? On macOS use the Apple Silicon build unless you have a 2019-or-older Intel Mac. On Linux pick the AppImage if you don't recognize the others. If a direct link 404s, the build for that platform may have failed — every shipped asset is also listed under \"Assets\" below.",
    '',
    '---',
    `**npm:** \`npm install -g glassbox@${version}\` — works everywhere Node 20+ runs, but lacks the native desktop window the installable builds ship with.`,
  );
  return lines.join('\n');
}

// CLI entry: `node release-assets.mjs download-section <version> <repo> <tag>`
// prints the markdown block. Used by the release workflow's notes step.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'download-section') {
    const [version, repo, tag] = rest;
    if (!version || !repo || !tag) {
      console.error('Usage: release-assets.mjs download-section <version> <repo> <tag>');
      process.exit(1);
    }
    process.stdout.write(downloadSection(version, repo, tag));
  } else {
    console.error(`Unknown command: ${command ?? '(none)'}`);
    process.exit(1);
  }
}
