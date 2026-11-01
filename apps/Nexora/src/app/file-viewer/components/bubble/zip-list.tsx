import { useEffect, useState } from "react"
import { Download, ExternalLink, Folder } from "lucide-react"
import { Button } from "@/shared/components/ui/button"
import { useLocalFile } from "@/app/file-viewer/hooks/useLocalFile"
import type { ViewerFile, ZipEntry, ZipRow } from "@/app/file-viewer/models/file-viewer.model"
import { showError, openExternal, openViewer, saveAs, listZipEntries, extractZipEntry } from "@/app/file-viewer/services/file-viewer.service"
import { getExtension, formatSize, buildZipTree } from "@/app/file-viewer/utils/file-viewer.utils"

export const ZipList = ({ file }: { file: ViewerFile }) => {
  const local = useLocalFile(file)
  const [entries, setEntries] = useState<{ data?: ZipEntry[]; error?: unknown }>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!local.data) return
    let live = true
    listZipEntries(local.data).then(
      (data) => live && setEntries({ data }),
      (error) => live && setEntries({ error }),
    )
    return () => {
      live = false
    }
  }, [local.data, attempt])

  if (local.error || entries.error)
    return (
      <p className="mt-2 text-xs">
        Không đọc được file zip.{" "}
        <button type="button" className="underline" onClick={() => (local.error ? local.refetch() : setAttempt((n) => n + 1))}>
          Thử lại
        </button>
      </p>
    )
  if (!entries.data) return <p className="mt-2 text-xs opacity-70">Đang tải… {local.progress}%</p>

  const openEntry = (r: ZipRow) =>
    extractZipEntry(local.data!, r.name)
      .then((path) => openViewer({ name: r.label, ext: getExtension(r.label), size: r.size, path }))
      .catch(showError)

  return (
    <div className="mt-2 border-t border-current/20 pt-2 text-xs">
      <div className="mb-1 flex items-center gap-1">
        <span className="opacity-70">{entries.data.filter((e) => !e.dir).length} file</span>
        <span className="flex-1" />
        <Button variant="ghost" size="xs" onClick={() => saveAs(file).catch(showError)}>
          <Download /> Lưu
        </Button>
        <Button variant="ghost" size="xs" onClick={() => openExternal(file).catch(showError)}>
          <ExternalLink /> Mở bằng ứng dụng khác
        </Button>
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {buildZipTree(entries.data).map((r) => (
          <li key={r.name} style={{ paddingLeft: r.depth * 12 }}>
            {r.dir ? (
              <span className="flex items-center gap-1 py-0.5 opacity-70">
                <Folder className="size-3.5 shrink-0" /> {r.label}
              </span>
            ) : (
              <button type="button" onClick={() => openEntry(r)} className="flex w-full items-center py-0.5 text-left hover:underline">
                <span className="truncate">{r.label}</span>
                <span className="ml-auto shrink-0 pl-3 opacity-70">{formatSize(r.size)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
