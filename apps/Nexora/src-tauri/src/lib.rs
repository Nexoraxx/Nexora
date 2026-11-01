mod commands;
mod models;
mod services;
mod ui;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| ui::window::show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            app.manage(services::server::spawn(&app.path().app_data_dir()?));
            ui::tray::build(app)?;
            #[cfg(target_os = "linux")]
            if let Some(main) = app.get_webview_window("main") {
                ui::window::disable_pinch_zoom(&main);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![commands::server::server_info, commands::clipboard::clipboard_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
