use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

/// Set up the system tray with the required actions:
/// 打开编辑器 / 下一组 / 暂停一小时 / 重新布局 / 恢复原壁纸 / 设置 / 退出
pub fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_i = MenuItem::with_id(app, "tray_open", "打开编辑器", true, None::<&str>)?;
    let next_i = MenuItem::with_id(app, "tray_next", "下一组", true, None::<&str>)?;
    let pause_i = MenuItem::with_id(app, "tray_pause", "暂停一小时", true, None::<&str>)?;
    let relayout_i = MenuItem::with_id(app, "tray_relayout", "重新布局", true, None::<&str>)?;
    let restore_i = MenuItem::with_id(app, "tray_restore", "恢复原壁纸", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "tray_settings", "设置", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_i,
            &next_i,
            &pause_i,
            &relayout_i,
            &restore_i,
            &settings_i,
            &quit_i,
        ],
    )?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .tooltip("注意力壁纸")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "tray_next" => {
                let _ = app.emit("tray://next-set", ());
            }
            "tray_pause" => {
                let _ = app.emit("tray://pause-one-hour", ());
            }
            "tray_relayout" => {
                let _ = app.emit("tray://relayout", ());
            }
            "tray_restore" => {
                let _ = app.emit("tray://restore", ());
            }
            "tray_settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("nav://settings", ());
                }
            }
            "tray_quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
