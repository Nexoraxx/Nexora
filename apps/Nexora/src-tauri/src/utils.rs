use std::path::PathBuf;

pub type AnyResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

// FNV-1a: stable across runs, unlike DefaultHasher
pub fn fnv1a_hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, &byte| (hash ^ byte as u64).wrapping_mul(0x100000001b3))
}

pub fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

pub async fn run_blocking<T: Send + 'static>(task: impl FnOnce() -> AnyResult<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}
