use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(not(debug_assertions))]
use serde::Deserialize;
use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_updater::UpdaterExt;

/// Holds the sidecar PID so it can be killed on app exit.
struct SidecarPid(Mutex<Option<u32>>);

/// Holds the version string of a pending update, if any.
struct PendingUpdate(Mutex<Option<String>>);

/// One CLI binary to install (source script in the bundle + dest on PATH).
struct CliEntry {
    source: PathBuf,
    dest: PathBuf,
}

/// Returns every CLI we install onto PATH. Currently `glassbox` and (since GB-853)
/// `glassbox-difftool`. Order matters for `install_cli`'s single osascript prompt
/// on macOS — both symlinks are created in one elevated shell so the user sees
/// one auth dialog, not two.
fn cli_entries(app: &tauri::AppHandle) -> Result<Vec<CliEntry>, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        Ok(vec![
            CliEntry {
                source: resource_dir.join("resources").join("glassbox"),
                dest: PathBuf::from("/usr/local/bin/glassbox"),
            },
            CliEntry {
                source: resource_dir.join("resources").join("glassbox-difftool"),
                dest: PathBuf::from("/usr/local/bin/glassbox-difftool"),
            },
        ])
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let bin_dir = PathBuf::from(home).join(".local/bin");
        Ok(vec![
            CliEntry {
                source: resource_dir.join("resources").join("glassbox-linux"),
                dest: bin_dir.join("glassbox"),
            },
            CliEntry {
                source: resource_dir
                    .join("resources")
                    .join("glassbox-difftool-linux"),
                dest: bin_dir.join("glassbox-difftool"),
            },
        ])
    }
    #[cfg(target_os = "windows")]
    {
        let local_app_data =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Users\\Public".to_string());
        let bin_dir = PathBuf::from(local_app_data)
            .join("Programs")
            .join("glassbox");
        Ok(vec![
            CliEntry {
                source: resource_dir.join("resources").join("glassbox.cmd"),
                dest: bin_dir.join("glassbox.cmd"),
            },
            CliEntry {
                source: resource_dir.join("resources").join("glassbox-difftool.cmd"),
                dest: bin_dir.join("glassbox-difftool.cmd"),
            },
        ])
    }
}

/// Returns the manual command string for installing every CLI entry. One
/// composite command per platform so the user can paste a single line.
fn manual_install_command(entries: &[CliEntry]) -> String {
    #[cfg(target_os = "macos")]
    {
        let parent = entries
            .first()
            .and_then(|e| e.dest.parent())
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        let links = entries
            .iter()
            .map(|e| format!("ln -sf \"{}\" \"{}\"", e.source.display(), e.dest.display()))
            .collect::<Vec<_>>()
            .join(" && ");
        format!("sudo sh -c 'mkdir -p \"{parent}\" && {links}'")
    }
    #[cfg(target_os = "linux")]
    {
        let parent = entries
            .first()
            .and_then(|e| e.dest.parent())
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        let links = entries
            .iter()
            .map(|e| format!("ln -sf \"{}\" \"{}\"", e.source.display(), e.dest.display()))
            .collect::<Vec<_>>()
            .join(" && ");
        format!("mkdir -p \"{parent}\" && {links}")
    }
    #[cfg(target_os = "windows")]
    {
        let parent = entries
            .first()
            .and_then(|e| e.dest.parent())
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        let copies = entries
            .iter()
            .map(|e| format!("copy \"{}\" \"{}\"", e.source.display(), e.dest.display()))
            .collect::<Vec<_>>()
            .join(" && ");
        format!("mkdir \"{parent}\" && {copies}")
    }
}

#[cfg(not(debug_assertions))]
#[derive(Deserialize, Default)]
struct ProjectSettings {
    #[serde(default, rename = "appName")]
    app_name: Option<String>,
}

#[cfg(not(debug_assertions))]
/// Determines the app/window title from .glassbox/settings.json or the project folder name.
fn resolve_app_name(project_dir: &str) -> String {
    let project_path = std::fs::canonicalize(project_dir)
        .unwrap_or_else(|_| std::path::PathBuf::from(project_dir));

    // Try reading settings.json from .glassbox in the project directory
    let settings_path = project_path.join(".glassbox").join("settings.json");
    if let Ok(contents) = std::fs::read_to_string(&settings_path) {
        if let Ok(settings) = serde_json::from_str::<ProjectSettings>(&contents) {
            if let Some(name) = settings.app_name {
                if !name.is_empty() {
                    return name;
                }
            }
        }
    }

    // Fall back to the project folder name
    if let Some(name) = project_path.file_name() {
        return format!("Glassbox — {}", name.to_string_lossy());
    }

    "Glassbox".to_string()
}

#[derive(Serialize)]
struct CliStatus {
    installed: bool,
    manual_command: String,
}

#[tauri::command]
fn check_cli_installed(app: tauri::AppHandle) -> Result<CliStatus, String> {
    let entries = cli_entries(&app)?;
    // `installed` is true only when EVERY entry is on PATH — if `glassbox`
    // is symlinked but `glassbox-difftool` isn't, the UI should still show
    // "install" so the missing half gets added (GB-853).
    let installed = entries.iter().all(|e| e.dest.exists());
    let manual_command = manual_install_command(&entries);
    Ok(CliStatus {
        installed,
        manual_command,
    })
}

#[derive(Serialize)]
struct InstallResult {
    path: String,
}

#[tauri::command]
fn install_cli(app: tauri::AppHandle) -> Result<InstallResult, String> {
    let entries = cli_entries(&app)?;

    for entry in &entries {
        if !entry.source.exists() {
            return Err(format!(
                "CLI script not found in app bundle: {}",
                entry.source.display()
            ));
        }
    }

    // The first entry's parent directory is the install dir (`/usr/local/bin`,
    // `~/.local/bin`, etc.). All entries currently share the same parent.
    let dest = entries
        .first()
        .map(|e| e.dest.clone())
        .ok_or_else(|| "No CLI entries to install".to_string())?;
    let parent = dest
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| dest.clone());

    #[cfg(target_os = "macos")]
    {
        // GB-853 — one osascript prompt for the whole install (both `glassbox`
        // and `glassbox-difftool`). Two prompts would feel like the install
        // half-failed even when it didn't.
        let mut shell_cmd = format!("mkdir -p '{}'", parent.display());
        for entry in &entries {
            shell_cmd.push_str(&format!(
                " && ln -sf '{}' '{}'",
                entry.source.display(),
                entry.dest.display()
            ));
        }
        let status = std::process::Command::new("osascript")
            .args([
                "-e",
                &format!("do shell script \"{shell_cmd}\" with administrator privileges"),
            ])
            .status()
            .map_err(|e| format!("Failed to run osascript: {e}"))?;

        if !status.success() {
            return Err("Installation canceled or failed".to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        std::fs::create_dir_all(&parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        for entry in &entries {
            // Remove existing symlink/file if present, then create fresh.
            let _ = std::fs::remove_file(&entry.dest);
            std::os::unix::fs::symlink(&entry.source, &entry.dest).map_err(|e| {
                format!("Failed to create symlink for {}: {e}", entry.dest.display())
            })?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        std::fs::create_dir_all(&parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        for entry in &entries {
            std::fs::copy(&entry.source, &entry.dest)
                .map_err(|e| format!("Failed to copy {}: {e}", entry.source.display()))?;
        }

        // Add to user PATH via registry
        let output = std::process::Command::new("reg")
            .args(["query", "HKCU\\Environment", "/v", "Path"])
            .output();

        if let Ok(output) = output {
            let current_path = String::from_utf8_lossy(&output.stdout).to_string();
            let install_dir = dest.parent().unwrap_or(&dest).to_string_lossy().to_string();
            if !current_path.contains(&install_dir) {
                // Extract current PATH value
                let path_value = current_path
                    .lines()
                    .find(|l| l.contains("REG_EXPAND_SZ") || l.contains("REG_SZ"))
                    .and_then(|l| l.split("    ").last())
                    .unwrap_or("")
                    .trim();

                let new_path = if path_value.is_empty() {
                    install_dir
                } else {
                    format!("{};{}", path_value, install_dir)
                };

                let _ = std::process::Command::new("reg")
                    .args([
                        "add",
                        "HKCU\\Environment",
                        "/v",
                        "Path",
                        "/t",
                        "REG_EXPAND_SZ",
                        "/d",
                        &new_path,
                        "/f",
                    ])
                    .status();
            }
        }
    }

    Ok(InstallResult {
        path: dest.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_pending_update(app: tauri::AppHandle) -> Option<String> {
    app.state::<PendingUpdate>().0.lock().unwrap().clone()
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(not(debug_assertions))]
    {
        let updater = app.updater().map_err(|e| format!("{e}"))?;
        let update = updater.check().await.map_err(|e| format!("{e}"))?;
        if let Some(update) = update {
            *app.state::<PendingUpdate>().0.lock().unwrap() = Some(update.version.clone());
            return Ok(Some(update.version));
        }
        return Ok(None);
    }
    #[allow(unreachable_code)]
    {
        let _ = &app;
        Ok(None)
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        *app.state::<PendingUpdate>().0.lock().unwrap() = None;
        let updater = app.updater().map_err(|e| format!("{e}"))?;
        let update = updater.check().await.map_err(|e| format!("{e}"))?;
        if let Some(update) = update {
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| format!("{e}"))?;
        }
    }
    let _ = &app;
    Ok(())
}

/// Build the argument vector for the dev-mode Node server launch.
///
/// We launch the server as `node --import tsx src/cli.ts …` rather than the old
/// `npx tsx …` form. The distinction matters for quit: `npx tsx` is a wrapper
/// (npx → node .bin/tsx → node src/cli.ts), so `child.id()` was the npx wrapper
/// PID, two levels above the real server. The quit-time `kill(pid)` only reached
/// the wrapper, and the `kill(-pid)` group kill targeted a process group the
/// server didn't lead, so the real `cli.ts` server orphaned and held the port +
/// lockfile. `node --import tsx` runs `cli.ts` IN the spawned process, so the
/// stored PID IS the server and the SIGTERM lands on its handler.
/// `TSX_TSCONFIG_PATH=tsconfig.json` (set on the spawn) replaces the old
/// `--tsconfig` CLI flag, which the loader form doesn't accept.
///
/// Note: no `--replace` — dev intentionally uses automatic port selection so a
/// still-running prior instance doesn't block a fresh launch.
#[cfg(debug_assertions)]
fn build_dev_server_args(app_args: &[String]) -> Vec<String> {
    let mut server_args = vec![
        "--import".to_string(),
        "tsx".to_string(),
        "src/cli.ts".to_string(),
        "--no-open".to_string(),
    ];
    // Skip argv[0] (binary name) and pass through any glassbox flags forwarded
    // from `tauri dev -- --all` etc.
    for arg in app_args.iter().skip(1) {
        server_args.push(arg.clone());
    }
    server_args
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarPid(Mutex::new(None)))
        .manage(PendingUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            check_cli_installed,
            install_cli,
            get_pending_update,
            check_for_update,
            install_update
        ])
        .setup(|_app| {
            #[allow(unused_variables)]
            let app = _app;

            // Build native menu with Edit > Find
            let app_handle = app.handle();
            let edit_menu = SubmenuBuilder::new(app_handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&MenuItem::with_id(
                    app_handle,
                    "find",
                    "Find",
                    true,
                    Some("CmdOrCtrl+F"),
                )?)
                .build()?;

            #[cfg(target_os = "macos")]
            let menu = MenuBuilder::new(app_handle)
                .item(
                    &SubmenuBuilder::new(app_handle, "Glassbox")
                        .about(None)
                        .separator()
                        .services()
                        .separator()
                        .hide()
                        .hide_others()
                        .show_all()
                        .separator()
                        .quit()
                        .build()?,
                )
                .item(&edit_menu)
                .item(
                    &SubmenuBuilder::new(app_handle, "Window")
                        .minimize()
                        .item(&PredefinedMenuItem::maximize(app_handle, None)?)
                        .close_window()
                        .separator()
                        .fullscreen()
                        .build()?,
                )
                .build()?;

            #[cfg(not(target_os = "macos"))]
            let menu = MenuBuilder::new(app_handle).item(&edit_menu).build()?;

            app.set_menu(menu)?;

            // Handle Edit > Find menu click
            let handle = app_handle.clone();
            app.on_menu_event(move |_app, event| {
                if event.id().0 == "find" {
                    let _ = handle.emit("menu-find", ());
                }
            });

            // Dev mode: spawn the Node server via tsx and navigate once it's ready.
            // Uses automatic port selection (no --strict-port) so dev isn't blocked
            // when a previous instance is still running.
            #[cfg(debug_assertions)]
            {
                let project_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .expect("CARGO_MANIFEST_DIR has no parent")
                    .to_path_buf();

                // Forward CLI args (e.g. --all, --staged) from `tauri dev -- --all`.
                // Launch as `node --import tsx` (NOT `npx tsx`) so the spawned
                // child IS the cli.ts server and is directly killable on quit;
                // see `build_dev_server_args`.
                let app_args: Vec<String> = std::env::args().collect();
                let server_args = build_dev_server_args(&app_args);

                let mut child = std::process::Command::new("node")
                    .args(&server_args)
                    .current_dir(&project_root)
                    // tsx-as-loader reads the tsconfig (jsx / jsxImportSource /
                    // paths) from here instead of the old `--tsconfig` CLI flag.
                    .env("TSX_TSCONFIG_PATH", "tsconfig.json")
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::inherit())
                    .spawn()
                    .expect("Failed to spawn dev server (node --import tsx)");

                let pid = child.id();
                *app.state::<SidecarPid>().0.lock().unwrap() = Some(pid);

                let window = app
                    .get_webview_window("main")
                    .expect("main window not found");

                // Read stdout in a background thread to find the server URL,
                // then keep draining so the pipe doesn't block the child process.
                // The whole `child` is moved in (not just its stdout) so we can
                // reap it with `wait()` once the dev server exits — otherwise it
                // lingers as a zombie (clippy::zombie_processes).
                std::thread::spawn(move || {
                    use std::io::{BufRead, BufReader};
                    let stdout = child.stdout.take().expect("stdout not captured");
                    let reader = BufReader::new(stdout);
                    for line in reader.lines() {
                        let Ok(line) = line else { break };
                        eprintln!("[dev-server] {}", line);
                        if let Some(idx) = line.find("running at ") {
                            let url = line[idx + "running at ".len()..].trim().to_string();
                            if let Ok(parsed) = url.parse() {
                                let _ = window.navigate(parsed);
                            }
                        }
                    }
                    let _ = child.wait();
                });

                return Ok(());
            }

            #[cfg(not(debug_assertions))]
            {
                let app_args: Vec<String> = std::env::args().collect();
                let has_project_dir = app_args.iter().any(|a| a == "--project-dir");

                if !has_project_dir {
                    // No --project-dir: show the welcome/setup screen
                    let window = app
                        .get_webview_window("main")
                        .expect("main window not found");
                    let _ = window.navigate("tauri://localhost/welcome.html".parse().unwrap());

                    // Check for updates (store version for user-initiated install)
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let Ok(updater) = handle.updater() else {
                            return;
                        };
                        let Ok(Some(update)) = updater.check().await else {
                            return;
                        };
                        *handle.state::<PendingUpdate>().0.lock().unwrap() = Some(update.version);
                    });

                    return Ok(());
                }

                // Set window title from settings or project folder name
                let window = app
                    .get_webview_window("main")
                    .expect("main window not found");
                if let Some(i) = app_args.iter().position(|a| a == "--project-dir") {
                    if let Some(dir) = app_args.get(i + 1) {
                        let name = resolve_app_name(dir);
                        let _ = window.set_title(&name);
                    }
                }

                // Check if the CLI launcher already started the server
                if let Ok(server_url) = std::env::var("GLASSBOX_SERVER_URL") {
                    // Navigate directly to the pre-started server
                    if let Ok(parsed) = server_url.parse() {
                        let _ = window.navigate(parsed);
                    }

                    // Store the pre-started server PID for cleanup on exit
                    if let Ok(pid_str) = std::env::var("GLASSBOX_SIDECAR_PID") {
                        if let Ok(pid) = pid_str.parse::<u32>() {
                            *app.state::<SidecarPid>().0.lock().unwrap() = Some(pid);
                        }
                    }
                } else {
                    // No pre-started server — spawn sidecar ourselves
                    let resource_dir = app
                        .path()
                        .resource_dir()
                        .map_err(|e| format!("Failed to get resource dir: {e}"))?;
                    let cli_js = resource_dir.join("server").join("cli.js");

                    let mut sidecar_args = vec![
                        cli_js.to_string_lossy().to_string(),
                        "--no-open".to_string(),
                    ];
                    if let Some(i) = app_args.iter().position(|a| a == "--project-dir") {
                        if let Some(dir) = app_args.get(i + 1) {
                            sidecar_args.push("--project-dir".to_string());
                            sidecar_args.push(dir.clone());
                        }
                    }
                    // GB-856 — forward `--diff <a> <b>` so the Linux/Windows
                    // `git difftool` path (where the launcher execs this binary,
                    // and the app spawns its own sidecar) actually renders the
                    // diff. Without this the window would open on the project's
                    // default mode instead of the requested comparison. macOS
                    // doesn't hit this branch (its launcher pre-starts the
                    // server and we connect via GLASSBOX_SERVER_URL).
                    if let Some(i) = app_args.iter().position(|a| a == "--diff") {
                        if let (Some(a), Some(b)) = (app_args.get(i + 1), app_args.get(i + 2)) {
                            sidecar_args.push("--diff".to_string());
                            sidecar_args.push(a.clone());
                            sidecar_args.push(b.clone());
                        }
                    }
                    // doc 19 / GB-861 — accumulating per-file DESKTOP mode. The
                    // `glassbox-difftool` wrapper launches the app with
                    // `--difftool-serve`; the app then spawns ONE long-lived
                    // accumulating server and shows a single window, and later
                    // per-file invocations append to that running session instead
                    // of opening another window. Closing the window kills the
                    // sidecar (RunEvent::Exit below), ending the session. macOS
                    // doesn't reach this branch — its launcher pre-starts the
                    // serve-mode server and we connect via GLASSBOX_SERVER_URL.
                    if app_args.iter().any(|a| a == "--difftool-serve") {
                        sidecar_args.push("--difftool-serve".to_string());
                    }

                    let sidecar = app
                        .shell()
                        .sidecar("glassbox-node")
                        .map_err(|e| format!("Failed to create sidecar command: {e}"))?;

                    let args_refs: Vec<&str> = sidecar_args.iter().map(|s| s.as_str()).collect();
                    let (mut rx, child) = sidecar
                        .args(&args_refs)
                        .spawn()
                        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

                    let sidecar_pid = child.pid();
                    *app.state::<SidecarPid>().0.lock().unwrap() = Some(sidecar_pid);

                    tauri::async_runtime::spawn(async move {
                        let _child = child;
                        let mut navigated = false;
                        while let Some(event) = rx.recv().await {
                            if let CommandEvent::Stdout(line) = event {
                                if !navigated {
                                    let line_str = String::from_utf8_lossy(&line);
                                    if let Some(idx) = line_str.find("running at ") {
                                        let url = line_str[idx + "running at ".len()..].trim();
                                        if let Ok(parsed) = url.parse() {
                                            let _ = window.navigate(parsed);
                                            navigated = true;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }

                // Check for updates (store version for user-initiated install)
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let Ok(updater) = handle.updater() else {
                        return;
                    };
                    let Ok(Some(update)) = updater.check().await else {
                        return;
                    };
                    *handle.state::<PendingUpdate>().0.lock().unwrap() = Some(update.version);
                });
            }

            #[allow(unreachable_code)]
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Kill the sidecar process on app exit
                if let Some(pid) = app_handle.state::<SidecarPid>().0.lock().unwrap().take() {
                    #[cfg(unix)]
                    {
                        // Kill the sidecar directly, then attempt group kill for children.
                        // Direct kill is essential: when Node is started from the CLI wrapper
                        // (backgrounded with &), it's not a process group leader, so the
                        // negative-PID group kill silently fails and orphans the process.
                        unsafe {
                            libc::kill(pid as i32, libc::SIGTERM);
                            libc::kill(-(pid as i32), libc::SIGTERM);
                        }
                    }
                    #[cfg(windows)]
                    {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/PID", &pid.to_string(), "/T", "/F"])
                            .status();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{manual_install_command, CliEntry};
    use std::path::PathBuf;

    fn sample_entries() -> Vec<CliEntry> {
        vec![
            CliEntry {
                source: PathBuf::from("/bundle/resources/glassbox"),
                dest: PathBuf::from("/dest/bin/glassbox"),
            },
            CliEntry {
                source: PathBuf::from("/bundle/resources/glassbox-difftool"),
                dest: PathBuf::from("/dest/bin/glassbox-difftool"),
            },
        ]
    }

    // The command must install BOTH CLIs in one pasteable line (one elevation
    // prompt), under the parent dir of the first entry's destination.
    #[test]
    fn manual_install_command_covers_every_entry() {
        let cmd = manual_install_command(&sample_entries());
        assert!(
            cmd.contains("glassbox-difftool"),
            "difftool CLI missing from command: {cmd}"
        );
        // The destination's parent directory is created first.
        assert!(
            cmd.contains("/dest/bin"),
            "destination parent missing from command: {cmd}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn manual_install_command_macos_shape() {
        let cmd = manual_install_command(&sample_entries());
        assert_eq!(
            cmd,
            "sudo sh -c 'mkdir -p \"/dest/bin\" && \
             ln -sf \"/bundle/resources/glassbox\" \"/dest/bin/glassbox\" && \
             ln -sf \"/bundle/resources/glassbox-difftool\" \"/dest/bin/glassbox-difftool\"'"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn manual_install_command_linux_shape() {
        let cmd = manual_install_command(&sample_entries());
        assert_eq!(
            cmd,
            "mkdir -p \"/dest/bin\" && \
             ln -sf \"/bundle/resources/glassbox\" \"/dest/bin/glassbox\" && \
             ln -sf \"/bundle/resources/glassbox-difftool\" \"/dest/bin/glassbox-difftool\""
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn manual_install_command_windows_shape() {
        let cmd = manual_install_command(&sample_entries());
        assert!(cmd.starts_with("mkdir "), "missing mkdir: {cmd}");
        assert_eq!(
            cmd.matches("copy ").count(),
            2,
            "expected two copies: {cmd}"
        );
    }
}

// Dev-mode server launch must spawn the cli.ts server IN-process
// (`node --import tsx`) so its PID is directly killable on quit, NOT via an
// `npx`/`tsx`-CLI wrapper whose real server is an unreachable grandchild that
// orphans on quit and holds the port + lockfile. Gated to debug builds because
// `build_dev_server_args` only exists there (it's the dev-only launch path).
// `cargo test` is a debug build, so this runs in CI.
#[cfg(all(test, debug_assertions))]
mod dev_server_args_tests {
    use super::build_dev_server_args;

    #[test]
    fn launches_cli_via_node_import_tsx_not_npx_wrapper() {
        let args = build_dev_server_args(&["glassbox".to_string()]);
        // node flags first: `--import tsx` runs cli.ts in THIS process, so the
        // spawned child PID is the server the quit-time SIGTERM must reach.
        assert_eq!(args[0], "--import");
        assert_eq!(args[1], "tsx");
        assert_eq!(args[2], "src/cli.ts");
        assert!(args.iter().any(|a| a == "--no-open"));
        // Guard against a regression to the old wrapper form, where the child
        // PID was `npx`/`tsx`-CLI and the server was an unkillable grandchild.
        assert!(!args.iter().any(|a| a == "npx"));
        assert_ne!(args[0], "tsx");
        // tsconfig is now passed via TSX_TSCONFIG_PATH env, not the CLI flag.
        assert!(!args.iter().any(|a| a == "--tsconfig"));
    }

    #[test]
    fn forwards_glassbox_flags_after_the_cli_entry() {
        let args = build_dev_server_args(&[
            "glassbox".to_string(),
            "--all".to_string(),
            "--staged".to_string(),
        ]);
        // argv[0] (the binary name) is dropped; the real flags are forwarded.
        assert!(args.iter().any(|a| a == "--all"));
        assert!(args.iter().any(|a| a == "--staged"));
        assert!(!args.iter().any(|a| a == "glassbox"));
    }
}
