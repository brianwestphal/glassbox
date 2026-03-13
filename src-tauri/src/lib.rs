use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(not(debug_assertions))]
use serde::Deserialize;
use serde::Serialize;
use tauri::Manager;

#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;
#[cfg(not(debug_assertions))]
use tauri_plugin_updater::UpdaterExt;

/// Holds the sidecar PID so it can be killed on app exit.
struct SidecarPid(Mutex<Option<u32>>);

/// Returns the expected symlink/install path for the CLI on this platform.
fn cli_install_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        PathBuf::from("/usr/local/bin/glassbox")
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join(".local/bin/glassbox")
    }
    #[cfg(target_os = "windows")]
    {
        let local_app_data =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\Users\\Public".to_string());
        PathBuf::from(local_app_data)
            .join("Programs")
            .join("glassbox")
            .join("glassbox.cmd")
    }
}

/// Returns the path to the CLI script bundled in the app resources.
fn cli_source_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        Ok(resource_dir.join("resources").join("glassbox"))
    }
    #[cfg(target_os = "linux")]
    {
        Ok(resource_dir.join("resources").join("glassbox-linux"))
    }
    #[cfg(target_os = "windows")]
    {
        Ok(resource_dir.join("resources").join("glassbox.cmd"))
    }
}

/// Returns the manual command string for installing the CLI.
fn manual_install_command(source: &PathBuf, dest: &PathBuf) -> String {
    #[cfg(target_os = "macos")]
    {
        format!(
            "sudo ln -sf \"{}\" \"{}\"",
            source.display(),
            dest.display()
        )
    }
    #[cfg(target_os = "linux")]
    {
        format!(
            "mkdir -p \"{}\" && ln -sf \"{}\" \"{}\"",
            dest.parent().unwrap_or(dest).display(),
            source.display(),
            dest.display()
        )
    }
    #[cfg(target_os = "windows")]
    {
        format!(
            "mkdir \"{}\" && copy \"{}\" \"{}\"",
            dest.parent().unwrap_or(dest).display(),
            source.display(),
            dest.display()
        )
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
    let dest = cli_install_path();
    let source = cli_source_path(&app)?;
    let installed = dest.exists();
    let manual_command = manual_install_command(&source, &dest);
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
    let source = cli_source_path(&app)?;
    let dest = cli_install_path();

    if !source.exists() {
        return Err(format!(
            "CLI script not found in app bundle: {}",
            source.display()
        ));
    }

    #[cfg(target_os = "macos")]
    {
        // Use osascript to get admin privileges for /usr/local/bin
        let status = std::process::Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "do shell script \"ln -sf '{}' '{}'\" with administrator privileges",
                    source.display(),
                    dest.display()
                ),
            ])
            .status()
            .map_err(|e| format!("Failed to run osascript: {e}"))?;

        if !status.success() {
            return Err("Installation cancelled or failed".to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Create ~/.local/bin if needed, then symlink
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        // Remove existing symlink/file if present
        let _ = std::fs::remove_file(&dest);
        std::os::unix::fs::symlink(&source, &dest)
            .map_err(|e| format!("Failed to create symlink: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        // Copy the .cmd file to the install location
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        std::fs::copy(&source, &dest)
            .map_err(|e| format!("Failed to copy CLI script: {e}"))?;

        // Add to user PATH via registry
        let output = std::process::Command::new("reg")
            .args([
                "query",
                "HKCU\\Environment",
                "/v",
                "Path",
            ])
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarPid(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![check_cli_installed, install_cli])
        .setup(|_app| {
            #[allow(unused_variables)]
            let app = _app;
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

                    // Still check for updates
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let Ok(updater) = handle.updater() else {
                            return;
                        };
                        let Ok(Some(update)) = updater.check().await else {
                            return;
                        };
                        let _ = update
                            .download_and_install(|_, _| {}, || {})
                            .await;
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
                                        let url =
                                            line_str[idx + "running at ".len()..].trim();
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

                // Check for updates in the background
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let Ok(updater) = handle.updater() else {
                        return;
                    };
                    let Ok(Some(update)) = updater.check().await else {
                        return;
                    };
                    let _ = update
                        .download_and_install(|_, _| {}, || {})
                        .await;
                });
            }

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
                        // Kill the sidecar and its child processes
                        unsafe { libc::kill(-(pid as i32), libc::SIGTERM); }
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
