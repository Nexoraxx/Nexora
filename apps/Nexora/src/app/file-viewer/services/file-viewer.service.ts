import { Channel, invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type { ViewerFile, ZipEntry } from "@/app/file-viewer/models/file-viewer.model";
import { getFileKey } from "@/app/file-viewer/utils/file-viewer.utils";

export const openViewer = (file: ViewerFile) => invoke("open_viewer", { file }).catch(showError);
export const listZipEntries = (path: string) => invoke<ZipEntry[]>("zip_entries", { path });
export const extractZipEntry = (path: string, name: string) => invoke<string>("zip_extract", { path, name });

function downloadFile(file: ViewerFile, onProgress?: (p: number) => void) {
  if (file.path) return Promise.resolve(file.path);
  const progress = new Channel<number>();
  if (onProgress) progress.onmessage = onProgress;
  return invoke<string>("download_file", { url: file.url, name: file.name, progress });
}

// One download per file, shared by the preview, "Lưu về máy" and "Mở bằng ứng dụng khác" (the Rust side caches the
// file on disk too); a failed one is forgotten so it can be retried.
const downloads = new Map<string, Promise<string>>();
export function getLocalPath(file: ViewerFile, onProgress?: (p: number) => void) {
  const key = getFileKey(file);
  let p = downloads.get(key);
  if (!p) {
    p = downloadFile(file, onProgress);
    downloads.set(key, p);
    p.catch(() => downloads.delete(key));
  }
  return p;
}

export async function saveAs(file: ViewerFile) {
  const dest = await save({ defaultPath: file.name });
  if (dest) await invoke("save_file", { src: await getLocalPath(file), dest });
}

export const openExternal = async (file: ViewerFile) => openPath(await getLocalPath(file));

// errors of viewer actions, shown by <ViewerErrors /> of the window they happen in
const errorListeners = new Set<(message: string) => void>();
export function showError(e: unknown) {
  console.error(e);
  errorListeners.forEach((l) => l(String(e)));
}
export function onViewerError(listener: (message: string) => void) {
  errorListeners.add(listener);
  return () => void errorListeners.delete(listener);
}
