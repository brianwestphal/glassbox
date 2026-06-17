// Register the app's own `#[tauri::command]`s with the ACL so they can be
// explicitly granted to the remotely-navigated WebView. Glassbox's frontend is
// served by the Node sidecar over `http://localhost:<port>` — a "remote" origin
// from Tauri's point of view — and the main window navigates there.
//
// Tauri 2.11 stopped treating a remote-origin webview as a trusted "app window".
// App commands that used to be allowed there by default started being rejected
// from the localhost frontend with `<cmd> not allowed. Plugin not found`. For
// Glassbox that would silently break the desktop updater flow (the update
// banner's `install_update`, settings' `check_for_update`, and the startup
// `get_pending_update` check). Glassbox is still on tauri 2.10.3, where these
// work without an explicit grant, but declaring them now is forward-compatible
// and harmless — so a future version bump can't break the updater unnoticed.
//
// Declaring the commands here generates `allow-<command>` / `deny-<command>`
// permissions (kebab-case) that `capabilities/remote-localhost.json` grants to
// the localhost origin. KEEP THIS LIST IN SYNC with the `generate_handler!`
// list in `src/lib.rs` (and the matching grants in the capability file).
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "check_cli_installed",
            "install_cli",
            "get_pending_update",
            "check_for_update",
            "install_update",
        ]),
    ))
    .expect("failed to run tauri-build");
}
