use crate::services::file_viewer::cache::write_cached;
use crate::utils::AnyResult;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub fn download_to(url: &str, dest: &Path, progress: impl Fn(u8)) -> AnyResult<PathBuf> {
    write_cached(dest, |out| {
        let response = ureq::get(url).call()?;
        let total = response.body().content_length().filter(|&total| total > 0);
        let mut body = response.into_body().into_reader();
        let (mut buffer, mut downloaded, mut last_percent) = (vec![0; 64 * 1024], 0u64, 0u8);
        loop {
            let read = body.read(&mut buffer)?;
            if read == 0 {
                return Ok(());
            }
            out.write_all(&buffer[..read])?;
            downloaded += read as u64;
            // gzip: the decoded bytes can exceed content-length
            if let Some(percent) = total.map(|total| (downloaded * 100 / total).min(100) as u8).filter(|&percent| percent != last_percent) {
                last_percent = percent;
                progress(percent);
            }
        }
    })
}
