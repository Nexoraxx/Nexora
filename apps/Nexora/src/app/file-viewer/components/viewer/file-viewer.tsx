import { type MouseEvent, useState } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Download, ExternalLink, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/shared/components/ui/button"
import { FileContent } from "@/app/file-viewer/components/viewer/file-content"
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, ZOOMABLE_TYPES } from "@/app/file-viewer/constants/file-viewer.constants"
import type { ViewerFile } from "@/app/file-viewer/models/file-viewer.model"
import { showError, openExternal, saveAs } from "@/app/file-viewer/services/file-viewer.service"
import { getFileType, formatSize } from "@/app/file-viewer/utils/file-viewer.utils"

export const FileViewer = ({ file }: { file: ViewerFile }) => {
  const [zoom, setZoom] = useState(1)
  const [page, setPage] = useState<[number, number]>()

  // Link trong pdf/docx mà để webview tự mở thì cửa sổ viewer bị điều hướng mất
  const handleLinkClick = (e: MouseEvent) => {
    const href = (e.target as HTMLElement).closest("a")?.getAttribute("href")
    if (!href || !/^https?:/.test(href)) return
    e.preventDefault()
    openUrl(href)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-sm text-foreground">
      <header className="flex items-center gap-1 border-b px-3 py-2">
        <span className="truncate font-medium">{file.name}</span>
        {file.size != null && <span className="shrink-0 px-1 text-muted-foreground">{formatSize(file.size)}</span>}
        <span className="flex-1" />
        {ZOOMABLE_TYPES.has(getFileType(file.ext)) && (
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Thu nhỏ" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / ZOOM_STEP))}>
              <ZoomOut />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Phóng to" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * ZOOM_STEP))}>
              <ZoomIn />
            </Button>
          </>
        )}
        {page && (
          <span className="shrink-0 px-2 text-muted-foreground">
            Trang {page[0]} / {page[1]}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={() => openExternal(file).catch(showError)}>
          <ExternalLink /> Mở bằng ứng dụng khác
        </Button>
        <Button size="sm" onClick={() => saveAs(file).catch(showError)}>
          <Download /> Lưu về máy
        </Button>
      </header>
      <main onClick={handleLinkClick} className="relative flex min-h-0 flex-1 overflow-auto bg-muted">
        <FileContent file={file} zoom={zoom} onPage={(current, total) => setPage([current, total])} />
      </main>
    </div>
  )
}
