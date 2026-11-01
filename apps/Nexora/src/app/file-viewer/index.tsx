import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileViewer } from "@/app/file-viewer/components/viewer/file-viewer";
import { ViewerErrors } from "@/app/file-viewer/components/viewer/viewer-errors";
import type { ViewerFile } from "@/app/file-viewer/models/file-viewer.model";
import { getFileKey } from "@/app/file-viewer/utils/file-viewer.utils";

// The "viewer" window: one file at a time, replaced when another is opened from the chat
export const FileViewerWindow = () => {
  const [file, setFile] = useState<ViewerFile | null>(null);

  // listen first, then ask Rust, so a file clicked while this window opens isn't missed
  useEffect(() => {
    const off = listen<ViewerFile>("viewer:open", (e) => setFile(e.payload));
    off.then(() => invoke<ViewerFile | null>("viewer_file")).then((f) => f && setFile(f));
    return () => void off.then((f) => f());
  }, []);

  return (
    <>
      {file && <FileViewer key={getFileKey(file)} file={file} />}
      <ViewerErrors />
    </>
  );
};
