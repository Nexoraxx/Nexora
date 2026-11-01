use crate::models::file_viewer::ZipEntry;
use crate::services::file_viewer::cache::write_cached;
use crate::utils::AnyResult;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

pub fn list_entries(zip: &Path) -> AnyResult<Vec<ZipEntry>> {
    let mut archive = ZipArchive::new(File::open(zip)?)?;
    (0..archive.len())
        .map(|i| {
            let entry = archive.by_index_raw(i)?;
            Ok(ZipEntry { name: entry.name().into(), size: entry.size(), dir: entry.is_dir() })
        })
        .collect()
}

pub fn extract_entry(zip: &Path, name: &str, dest: &Path) -> AnyResult<PathBuf> {
    let mut archive = ZipArchive::new(File::open(zip)?)?;
    let mut entry = archive.by_name(name)?;
    if entry.is_dir() || entry.enclosed_name().is_none() {
        return Err(format!("invalid entry: {name}").into());
    }
    write_cached(dest, |out| {
        io::copy(&mut entry, out)?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn list_and_extract() {
        let dir = std::env::temp_dir().join(format!("nexora-viewer-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let zip = dir.join("t.zip");
        let mut writer = zip::ZipWriter::new(File::create(&zip).unwrap());
        writer.add_directory("d/", SimpleFileOptions::default()).unwrap();
        writer.start_file("d/a.txt", SimpleFileOptions::default()).unwrap();
        writer.write_all(b"hello").unwrap();
        writer.start_file("../x", SimpleFileOptions::default()).unwrap();
        writer.write_all(b"evil").unwrap();
        writer.finish().unwrap();

        let names: Vec<_> = list_entries(&zip).unwrap().into_iter().map(|e| (e.name, e.size, e.dir)).collect();
        assert_eq!(names, [("d/".into(), 0, true), ("d/a.txt".into(), 5, false), ("../x".into(), 4, false)]);

        let out = extract_entry(&zip, "d/a.txt", &dir.join("out/a.txt")).unwrap();
        assert_eq!(std::fs::read_to_string(out).unwrap(), "hello");
        assert!(extract_entry(&zip, "../x", &dir.join("out/x")).is_err());
        assert!(!dir.join("out/x").exists());

        std::fs::remove_dir_all(dir).unwrap();
    }
}
