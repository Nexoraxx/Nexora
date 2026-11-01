use crate::models::server::{Server, ServerInfo};

#[tauri::command]
pub fn server_info(server: tauri::State<Server>) -> ServerInfo {
    server.info.clone()
}
