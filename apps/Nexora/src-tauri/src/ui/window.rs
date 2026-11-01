use tauri::{AppHandle, Manager};

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "linux")]
pub fn disable_pinch_zoom(window: &tauri::WebviewWindow) {
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
