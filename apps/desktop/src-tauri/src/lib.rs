use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, LogicalPosition, LogicalSize, Manager, Position, RunEvent, Size, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

static CLICK_THROUGH: AtomicBool = AtomicBool::new(false);

const PILL_WIDTH: f64 = 280.0;
const PILL_HEIGHT: f64 = 52.0;
const DRAWER_WIDTH: f64 = 416.0;
const DRAWER_HEIGHT: f64 = 632.0;
const EDGE_MARGIN: f64 = 16.0;

struct BackendProcess(Mutex<Option<Child>>);

impl BackendProcess {
    fn kill_if_running(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn is_backend_listening() -> bool {
    let addr: SocketAddr = "127.0.0.1:4789".parse().expect("valid socket addr");
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn resolve_server_command(app: &tauri::AppHandle) -> Option<(PathBuf, PathBuf)> {
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };

    if let Ok(res_dir) = app.path().resource_dir() {
        for sub in ["resources/server", "server"] {
            let dir = res_dir.join(sub);
            let bundled_node = dir.join(node_name);
            let bundled_cli = dir.join("cli.cjs");
            if bundled_node.exists() && bundled_cli.exists() {
                return Some((bundled_node, bundled_cli));
            }
            if bundled_cli.exists() {
                return Some((PathBuf::from("node"), bundled_cli));
            }
        }
    }

    let manifest_cli = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/server/dist/cli.js");
    if manifest_cli.exists() {
        return Some((PathBuf::from("node"), manifest_cli));
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent();
        for _ in 0..6 {
            if let Some(d) = dir {
                let candidate = d.join("packages/server/dist/cli.js");
                if candidate.exists() {
                    return Some((PathBuf::from("node"), candidate));
                }
                dir = d.parent();
            }
        }
    }

    None
}

fn ensure_backend_running(app: &tauri::AppHandle) -> Option<Child> {
    if is_backend_listening() {
        return None;
    }

    let (node_bin, cli_path) = resolve_server_command(app)?;
    let mut cmd = Command::new(&node_bin);
    cmd.arg(&cli_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().ok()
}

#[tauri::command]
fn set_pill_mode(window: WebviewWindow, is_pill: bool) -> Result<(), String> {
    let (target_w, target_h) = if is_pill {
        (PILL_WIDTH, PILL_HEIGHT)
    } else {
        (DRAWER_WIDTH, DRAWER_HEIGHT)
    };

    window
        .set_size(Size::Logical(LogicalSize::new(target_w, target_h)))
        .map_err(|e| e.to_string())?;

    // Clamp window position to screen work area so expanding never overflows right/bottom edges
    if let (Ok(Some(monitor)), Ok(pos), Ok(scale)) = (
        window.current_monitor(),
        window.outer_position(),
        window.scale_factor(),
    ) {
        let work_w = monitor.size().width as f64 / scale;
        let work_h = monitor.size().height as f64 / scale;
        let cur_x = pos.x as f64 / scale;
        let cur_y = pos.y as f64 / scale;

        let clamped_x = cur_x
            .min((work_w - target_w - EDGE_MARGIN).max(EDGE_MARGIN))
            .max(EDGE_MARGIN);
        let clamped_y = cur_y
            .min((work_h - target_h - EDGE_MARGIN).max(EDGE_MARGIN))
            .max(EDGE_MARGIN);

        let _ = window.set_position(Position::Logical(LogicalPosition::new(clamped_x, clamped_y)));
    }

    Ok(())
}

#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    CLICK_THROUGH.store(ignore, Ordering::Relaxed);
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let toggle_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyT);
                    let passthrough_shortcut =
                        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyT);

                    if shortcut == &toggle_shortcut {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.emit("tokenlens://toggle-drawer", ());
                        }
                    } else if shortcut == &passthrough_shortcut {
                        let next = !CLICK_THROUGH.load(Ordering::Relaxed);
                        CLICK_THROUGH.store(next, Ordering::Relaxed);
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.set_ignore_cursor_events(next);
                            let _ = win.emit("tokenlens://click-through", next);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Auto-start local @tokenlens/server if port 4789 is not already listening
            if let Some(child) = ensure_backend_running(app.handle()) {
                if let Ok(mut guard) = app.state::<BackendProcess>().0.lock() {
                    *guard = Some(child);
                }
            }

            // Position window at top-right corner on initial launch
            if let Some(win) = app.get_webview_window("main") {
                if let (Ok(Some(monitor)), Ok(scale)) = (win.current_monitor(), win.scale_factor()) {
                    let work_w = monitor.size().width as f64 / scale;
                    let x = (work_w - DRAWER_WIDTH - EDGE_MARGIN).max(EDGE_MARGIN);
                    let _ = win.set_position(Position::Logical(LogicalPosition::new(x, EDGE_MARGIN)));
                }
            }

            // Register Alt+T and Alt+Shift+T global hotkeys
            let _ = app
                .global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT), Code::KeyT));
            let _ = app
                .global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyT));

            // System Tray menu
            let toggle_item =
                MenuItem::with_id(app, "toggle", "展开/收起 (Alt+T)", true, None::<&str>)?;
            let passthrough_item = MenuItem::with_id(
                app,
                "passthrough",
                "切换鼠标穿透 (Alt+Shift+T)",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 TokenLens", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &passthrough_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("TokenLens Desktop")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.emit("tokenlens://toggle-drawer", ());
                        }
                    }
                    "passthrough" => {
                        let next = !CLICK_THROUGH.load(Ordering::Relaxed);
                        CLICK_THROUGH.store(next, Ordering::Relaxed);
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.set_ignore_cursor_events(next);
                            let _ = win.emit("tokenlens://click-through", next);
                        }
                    }
                    "quit" => {
                        app.state::<BackendProcess>().kill_if_running();
                        app.exit(0);
                    }
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_pill_mode, set_click_through])
        .build(tauri::generate_context!())
        .expect("error while building TokenLens Desktop");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            app_handle.state::<BackendProcess>().kill_if_running();
        }
    });
}
