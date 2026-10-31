use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct ServerInfo {
    port: u16,
    token: String,
}

// The child keeps its stdin pipe open; when this app exits the pipe closes and the server shuts itself down.
struct Server {
    info: ServerInfo,
    _child: Mutex<Child>,
}

#[tauri::command]
fn server_info(server: tauri::State<Server>) -> ServerInfo {
    server.info.clone()
}

// Files copied in a file manager reach WebKit's paste event as a bare "text/uri-list" with the paths hidden from the
// page; GTK's clipboard still has them. Not async, so Tauri runs it on the main thread, where GTK must be used.
#[tauri::command]
fn clipboard_files() -> Vec<String> {
    #[cfg(target_os = "linux")]
    return gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD)
        .wait_for_uris()
        .iter()
        .filter_map(|uri| gtk::glib::filename_from_uri(uri).ok())
        .map(|(path, _)| path.to_string_lossy().into_owned())
        .collect();
    #[cfg(not(target_os = "linux"))]
    Vec::new()
}

// Dev: the server's source, run with `bun` from this repo.
#[cfg(debug_assertions)]
fn server_command() -> Command {
    let mut cmd = Command::new("bun");
    cmd.args(["run", "src/index.ts"]).current_dir(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../server"));
    cmd
}

// Release: the server executable from scripts/build-server.ts, which Tauri's externalBin puts beside the app's own
// (Contents/MacOS on macOS), its target triple dropped.
#[cfg(not(debug_assertions))]
fn server_command() -> Command {
    let app = std::env::current_exe().expect("app executable path");
    #[allow(unused_mut)]
    let mut cmd = Command::new(app.with_file_name(format!("nexora-server{}", std::env::consts::EXE_SUFFIX)));
    // it's a console program: without CREATE_NO_WINDOW, Windows opens a console window beside the app
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x0800_0000);
    cmd
}

fn spawn_server(data_dir: &Path) -> Server {
    let mut child = server_command()
        .env("DATA_DIR", data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to start the Nexora server (dev: is `bun` on PATH?)");

    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let info = loop {
        let line = lines.next().expect("server exited before READY").expect("read server stdout");
        if let Some(json) = line.strip_prefix("READY ") {
            break serde_json::from_str(json).expect("invalid READY line");
        }
        println!("{line}");
    };
    std::thread::spawn(move || lines.map_while(Result::ok).for_each(|line| println!("{line}")));
    Server { info, _child: Mutex::new(child) }
}

// WebKitGTK zooms on touchpad/touchscreen pinch through its own GtkGestureZoom, stored on the view as
// "wk-view-zoom-gesture"; neither the page nor Tauri's zoomHotkeysEnabled reaches it. A gesture with
// propagation phase NONE gets no events. (Windows: zoomHotkeysEnabled=false already disables pinch;
// macOS: WKWebView magnification is off by default.)
#[cfg(target_os = "linux")]
fn disable_pinch_zoom(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use gtk::glib::translate::from_glib_none;
        use gtk::prelude::*;
        let view = webview.inner();
        match unsafe { view.data::<gtk::ffi::GtkGesture>("wk-view-zoom-gesture") } {
            Some(ptr) => unsafe { from_glib_none::<_, gtk::Gesture>(ptr.as_ptr()) }.set_propagation_phase(gtk::PropagationPhase::None),
            None => eprintln!("WebKitGTK zoom gesture not found; pinch zoom stays enabled"),
        }
    });
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}


fn tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Mở Nexora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip("Nexora")
        .menu(&Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &quit])?)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // one instance, as Zalo PC: launching again while it sits in the tray shows the window instead of
        // starting a second server on the same accounts
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(spawn_server(&data_dir));
            tray(app)?;
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                disable_pinch_zoom(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![server_info, clipboard_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
