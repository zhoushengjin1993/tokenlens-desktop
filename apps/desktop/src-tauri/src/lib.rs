use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

static CLICK_THROUGH: AtomicBool = AtomicBool::new(false);

const PILL_WIDTH: f64 = 280.0;
const PILL_HEIGHT: f64 = 52.0;
const DRAWER_WIDTH: f64 = 416.0;
const DRAWER_HEIGHT: f64 = 632.0;
const EDGE_MARGIN: f64 = 16.0;

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

        let clamped_x = cur_x.min((work_w - target_w - EDGE_MARGIN).max(EDGE_MARGIN)).max(EDGE_MARGIN);
        let clamped_y = cur_y.min((work_h - target_h - EDGE_MARGIN).max(EDGE_MARGIN)).max(EDGE_MARGIN);

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
    tauri::Builder::default()
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
            let toggle_item = MenuItem::with_id(app, "toggle", "展开/收起 (Alt+T)", true, None::<&str>)?;
            let passthrough_item =
                MenuItem::with_id(app, "passthrough", "切换鼠标穿透 (Alt+Shift+T)", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 TokenLens", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &passthrough_item, &quit_item])?;

            TrayIconBuilder::new()
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
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_pill_mode, set_click_through])
        .run(tauri::generate_context!())
        .expect("error while running TokenLens Desktop");
}
