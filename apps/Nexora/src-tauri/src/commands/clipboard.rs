#[tauri::command]
pub fn clipboard_files() -> Vec<String> {
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
