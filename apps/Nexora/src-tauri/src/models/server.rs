use std::process::Child;
use std::sync::Mutex;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ServerInfo {
    port: u16,
    token: String,
}

pub struct Server {
    pub info: ServerInfo,
    pub _child: Mutex<Child>,
}
