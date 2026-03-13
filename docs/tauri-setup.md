# Tauri Desktop App Setup

## Prerequisites

### 1. Install Rust toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart your terminal, then verify with `rustc --version`.

### 2. Install npm dependencies

```bash
npm install
```

This picks up the new `@tauri-apps/cli` dev dependency.

## One-time configuration

### 3. Generate updater signing keys

This keypair is used to sign and verify auto-updates (separate from Apple code signing).

```bash
npx tauri signer generate -w ~/.tauri/glassbox.key
```

It prints a **public key** — copy it and paste it into `src-tauri/tauri.conf.json` as the `plugins.updater.pubkey` value (replacing the empty string).

**Back up `~/.tauri/glassbox.key` securely.** If you lose it, existing installations can never receive updates.

### 4. Create app icons

Design or generate a 1024x1024 PNG for the app icon, then:

```bash
npx tauri icon path/to/icon-1024x1024.png
```

This generates all needed sizes into `src-tauri/icons/`.

### 5. Set up GitHub secrets

Go to **Settings → Secrets and variables → Actions → Repository secrets** in your GitHub repo and add:

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/glassbox.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you set (if any) when generating the key |

#### macOS code signing (Apple Developer account)

**Create the certificate:**

1. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates)
2. Click **+** to create a new certificate
3. Select **"Developer ID Application"** (under "Software") and click Continue
4. You'll be asked for a Certificate Signing Request (CSR):
   - Open **Keychain Access** → menu bar → **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**
   - Enter your email, leave CA Email blank, select **"Saved to disk"**, click Continue
   - Save the `.certSigningRequest` file
5. Upload the CSR on the Apple Developer portal, click Continue
6. Download the generated `.cer` file and double-click it to install in Keychain Access

**Export as .p12:**

7. Open **Keychain Access** → **My Certificates** (in the left sidebar under "Category")
8. Find your **"Developer ID Application: Your Name"** certificate, expand it to verify it has a private key attached
9. Right-click the certificate → **Export** → choose **Personal Information Exchange (.p12)** format
10. Set an export password (you'll need this as `APPLE_CERTIFICATE_PASSWORD`)
11. Save the `.p12` file

**Base64 encode for GitHub:**

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

This copies the base64 string to your clipboard, ready to paste as a GitHub secret.

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | The base64-encoded `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_PASSWORD` | An [app-specific password](https://support.apple.com/en-us/102654) (not your Apple ID password) |
| `APPLE_TEAM_ID` | Your 10-character team ID from the Developer portal |

## Local development

**Dev mode** (runs Node server + Tauri window separately — hot-reloads the server):

```bash
npm run tauri:dev
```

**Production build** (compiles sidecar + packages the app):

```bash
npm run tauri:build
```

The `.app` bundle lands in `src-tauri/target/release/bundle/macos/`.

## Releasing

Push a version tag to trigger the CI workflow:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow (`.github/workflows/release-desktop.yml`) builds for all 4 targets (macOS arm64/x64, Linux x64, Windows x64), signs the macOS builds, generates `latest.json` for auto-updates, and creates a **draft** GitHub Release with all artifacts. Review and publish it when ready.

You can also trigger a release manually from the Actions tab using the "Run workflow" button.

## Version management

Three files contain the version number and must stay in sync:

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `package.version`

The `scripts/release.sh` script updates all three automatically.

## Known considerations

- **Node.js sidecar**: The desktop app bundles a Node.js binary as the sidecar runtime (rather than compiling to a single binary). This is because PGLite requires filesystem access to its WASM/data files, which breaks single-binary compilers (pkg, bun compile). The build script downloads the correct Node.js binary for each target platform.
- **Windows signing**: Skipped for now. Users will see a SmartScreen warning on first download. Can add Azure Trusted Signing ($10/month) later.
