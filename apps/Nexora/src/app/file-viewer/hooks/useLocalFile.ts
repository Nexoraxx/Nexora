import { useEffect, useState } from "react";
import type { ViewerFile } from "@/app/file-viewer/models/file-viewer.model";
import { getLocalPath } from "@/app/file-viewer/services/file-viewer.service";
import { getFileKey } from "@/app/file-viewer/utils/file-viewer.utils";

// the file on disk (downloaded into the app cache on first use), with the download's progress
export function useLocalFile(file: ViewerFile, enabled = true) {
  const [state, setState] = useState<{ data?: string; error?: unknown }>({});
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState({});
    getLocalPath(file, setProgress).then(
      (data) => live && setState({ data }),
      (error) => live && setState({ error }),
    );
    return () => {
      live = false;
    };
  }, [getFileKey(file), enabled, attempt]);
  return { ...state, progress, refetch: () => setAttempt((a) => a + 1) };
}
