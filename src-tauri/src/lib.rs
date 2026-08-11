pub mod commands;
pub mod db;
pub mod platform;
pub mod tray;

use std::sync::Mutex;
use tauri::Manager;

/// Shared application state held by Tauri's managed state.
pub struct AppState {
    pub db: Mutex<db::Database>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("attention-wallpaper.sqlite");
            let database = db::Database::open(&db_path)?;
            database.init_schema()?;

            app.manage(AppState {
                db: Mutex::new(database),
            });

            tray::setup_tray(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_monitors,
            commands::get_desktop_icon_rects,
            commands::apply_wallpaper,
            commands::restore_wallpaper,
            commands::list_content,
            commands::save_content,
            commands::delete_content,
            commands::get_settings,
            commands::set_settings,
            commands::get_rotation_state,
            commands::set_rotation_state,
            commands::get_models_status,
            commands::get_wallpaper_profile,
            commands::set_wallpaper_profile,
            commands::next_set,
            commands::pause_one_hour,
            // relayout removed per ADR-0023 (frontend-only operation now)
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
