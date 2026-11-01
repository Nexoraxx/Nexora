import { type ComponentType, lazy, Suspense, useState } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Download } from "lucide-react"
import { Button } from "@/shared/components/ui/button"
import { FileStatus } from "@/app/file-viewer/components/viewer/file-status"
import { OpenExternalButton } from "@/app/file-viewer/components/viewer/open-external-button"
import { TextView } from "@/app/file-viewer/components/previews/text-view"
import { useLocalFile } from "@/app/file-viewer/hooks/useLocalFile"
import type { FileType, ViewProps } from "@/app/file-viewer/models/file-viewer.model"
import { showError, saveAs } from "@/app/file-viewer/services/file-viewer.service"
import { getFileType } from "@/app/file-viewer/utils/file-viewer.utils"
import { useMediaSrc } from "@/shared/hooks/use-media"

const PdfView = lazy(() => import("@/app/file-viewer/components/previews/pdf-view").then((m) => ({ default: m.PdfView })))
const DocxView = lazy(() => import("@/app/file-viewer/components/previews/docx-view").then((m) => ({ default: m.DocxView })))
const SheetView = lazy(() => import("@/app/file-viewer/components/previews/sheet-view").then((m) => ({ default: m.SheetView })))

const VIEWS: Partial<Record<FileType, ComponentType<ViewProps>>> = {
  pdf: PdfView,
  docx: DocxView,
  xlsx: SheetView,
  csv: SheetView,
  txt: TextView,
  code: TextView,
}

export const FileContent = ({ file, zoom, onPage }: Pick<ViewProps, "file" | "zoom" | "onPage">) => {
  const type = getFileType(file.ext)
  const View = VIEWS[type]
  const local = useLocalFile(file, !!View)
  const [broken, setBroken] = useState(false)
  const isMedia = type === "image" || type === "video" || type === "audio"
  // Nexora: a chat's E2EE media (and JPEG XL where the webview can't decode it) comes through the account's server
  const media = useMediaSrc(file.accountId ?? "", isMedia && !file.path ? file.url : undefined)
  const onError = (e: unknown) => {
    console.warn(e)
    setBroken(true)
  }

  if (broken)
    return (
      <FileStatus file={file} title="Không hiển thị được file này">
        <OpenExternalButton file={file} />
      </FileStatus>
    )

  if (isMedia) {
    const src = file.path ? convertFileSrc(file.path) : media
    if (src === null) return <FileStatus file={file} title="Không hiển thị được file này"><OpenExternalButton file={file} /></FileStatus>
    if (!src) return <FileStatus file={file} title="Đang tải…" />
    // zoom không nhân % nên giới hạn max cũng phải nhân theo, không thì ảnh to bị kẹp ở khung
    const max = `${zoom * 100}%`
    if (type === "image") return <img src={src} alt={file.name} style={{ zoom, maxWidth: max, maxHeight: max }} onError={onError} className="m-auto object-contain" />
    if (type === "video") return <video src={src} controls autoPlay onError={onError} className="m-auto max-h-full max-w-full" />
    return <audio src={src} controls autoPlay onError={onError} className="m-auto" />
  }

  if (!View)
    return (
      <FileStatus file={file} title={file.name} description="Không xem trước được loại file này">
        <OpenExternalButton file={file} />
        <Button onClick={() => saveAs(file).catch(showError)}>
          <Download /> Lưu về máy
        </Button>
      </FileStatus>
    )

  if (local.error)
    return (
      <FileStatus file={file} title="Không tải được file" description={String(local.error)}>
        <Button variant="outline" onClick={() => local.refetch()}>
          Thử lại
        </Button>
        {file.url && <Button onClick={() => openUrl(file.url!)}>Mở trong trình duyệt</Button>}
      </FileStatus>
    )

  if (!local.data) return <FileStatus file={file} title={`Đang tải… ${local.progress}%`} />

  return (
    <Suspense fallback={<FileStatus file={file} title="Đang mở…" />}>
      <View src={convertFileSrc(local.data)} file={file} zoom={zoom} onPage={onPage} onError={onError} />
    </Suspense>
  )
}
