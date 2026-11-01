use crate::models::file_viewer::{ViewerFile, ZipEntry};
use crate::services::file_viewer::archive;
use crate::services::file_viewer::cache::{cache_dir, ensure_in_cache, safe_name};
use crate::services::file_viewer::download::download_to;
use crate::utils::{fnv1a_hash, path_to_string, run_blocking};
use std::fs;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const WINDOW_LABEL: &str = "viewer";


static CURRENT_FILE: Mutex<Option<ViewerFile>> = Mutex::new(None);

#[tauri::command]
pub async fn open_viewer(app: AppHandle, file: ViewerFile) -> Result<(), String> {
    let title = file.name.clone();
    *CURRENT_FILE.lock().unwrap() = Some(file.clone());
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        app.emit_to(WINDOW_LABEL, "viewer:open", file).map_err(|e| e.to_string())?;
        window.set_title(&title).map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(960.0, 720.0)
        .min_inner_size(400.0, 300.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn viewer_file() -> Option<ViewerFile> {
    CURRENT_FILE.lock().unwrap().clone()
}

#[tauri::command]
pub async fn download_file(app: AppHandle, url: String, name: String, progress: Channel<u8>) -> Result<String, String> {
    let dest = cache_dir(&app, "files")?.join(format!("{:016x}", fnv1a_hash(url.as_bytes()))).join(safe_name(&name));
    run_blocking(move || download_to(&url, &dest, |percent| drop(progress.send(percent)))).await.map(path_to_string)
}

#[tauri::command]
pub async fn zip_entries(app: AppHandle, path: String) -> Result<Vec<ZipEntry>, String> {
    let zip = ensure_in_cache(&app, &path)?;
    run_blocking(move || archive::list_entries(&zip)).await
}

#[tauri::command]
pub async fn zip_extract(app: AppHandle, path: String, name: String) -> Result<String, String> {
    let zip = ensure_in_cache(&app, &path)?;
    let hash = fnv1a_hash(format!("{}\0{name}", zip.display()).as_bytes());
    let dest = cache_dir(&app, "zip")?.join(format!("{hash:016x}")).join(safe_name(&name));
    run_blocking(move || archive::extract_entry(&zip, &name, &dest)).await.map(path_to_string)
}

#[tauri::command]
pub async fn save_file(app: AppHandle, src: String, dest: String) -> Result<(), String> {
    let src = ensure_in_cache(&app, &src)?;
    fs::copy(src, dest).map(drop).map_err(|e| e.to_string())
}
