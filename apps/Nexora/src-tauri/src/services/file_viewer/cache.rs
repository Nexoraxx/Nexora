use crate::utils::AnyResult;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

pub fn cache_dir(app: &AppHandle, subdir: &str) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map(|dir| dir.join(subdir)).map_err(|e| e.to_string())
}

pub fn ensure_in_cache(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let cache_root = cache_dir(app, "")?.canonicalize().map_err(|e| e.to_string())?;
    let resolved = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    if resolved.starts_with(cache_root) { Ok(resolved) } else { Err("file outside the cache".into()) }
}

pub fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base.chars().map(|c| if c.is_control() || r#"<>:"|?*"#.contains(c) { '_' } else { c }).collect();
    match cleaned.trim_end_matches(['.', ' ']) {
        "" => "file".into(),
        trimmed => trimmed.into(),
    }
}

// written to a .part file then renamed: a half-downloaded file is never taken as cached
pub fn write_cached(dest: &Path, write: impl FnOnce(&mut File) -> AnyResult<()>) -> AnyResult<PathBuf> {
    static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
    if dest.exists() {
        return Ok(dest.into());
    }
    fs::create_dir_all(dest.parent().ok_or("no parent directory")?)?;
    let mut temp_path = dest.as_os_str().to_owned();
    temp_path.push(format!(".{}.part", TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)));
    let result = File::create(&temp_path).map_err(Into::into).and_then(|mut file| write(&mut file));
    if let Err(e) = result.and_then(|_| fs::rename(&temp_path, dest).map_err(Into::into)) {
        let _ = fs::remove_file(&temp_path);
        return Err(e);
    }
    mark_downloaded(dest);
    Ok(dest.into())
}

// Mark-of-the-Web as browsers do: Windows warns before running an .exe, .bat, ... that came from Zalo
#[cfg(windows)]
fn mark_downloaded(path: &Path) {
    let mut ads = path.as_os_str().to_owned();
    ads.push(":Zone.Identifier");
    let _ = fs::write(ads, "[ZoneTransfer]\r\nZoneId=3\r\n");
}

#[cfg(not(windows))]
fn mark_downloaded(_: &Path) {}

#[cfg(test)]
mod tests {
    use super::safe_name;

    #[test]
    fn safe_names() {
        assert_eq!(safe_name("../a/b:c.txt"), "b_c.txt");
        assert_eq!(safe_name("..\\x?.pdf"), "x_.pdf");
        assert_eq!(safe_name(".."), "file");
        assert_eq!(safe_name("bao cao. "), "bao cao");
        assert_eq!(safe_name("Báo cáo quý 3.pdf"), "Báo cáo quý 3.pdf");
    }
}
