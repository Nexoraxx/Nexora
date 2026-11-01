import { useEffect, useState } from "react";
import { ErrorBanner } from "@/shared/components/error-banner";
import { onViewerError } from "@/app/file-viewer/services/file-viewer.service";

// the last failed viewer action (open, save, open with another app) of this window
export function ViewerErrors() {
  const [error, setError] = useState<string>();
  useEffect(() => onViewerError(setError), []);
  return error ? <ErrorBanner className="fixed inset-x-0 bottom-0 z-50" text={`Có lỗi xảy ra\n${error}`} onClose={() => setError(undefined)} /> : null;
}
