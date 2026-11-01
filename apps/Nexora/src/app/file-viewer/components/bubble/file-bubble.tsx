import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/components/ui/collapsible"
import { ZipList } from "@/app/file-viewer/components/bubble/zip-list"
import { FILE_ICONS } from "@/app/file-viewer/constants/file-viewer.constants"
import type { ViewerFile } from "@/app/file-viewer/models/file-viewer.model"
import { openViewer } from "@/app/file-viewer/services/file-viewer.service"
import { getFileType, formatSize } from "@/app/file-viewer/utils/file-viewer.utils"

export const FileBubble = ({ file }: { file: ViewerFile }) => {
  const Icon = FILE_ICONS[getFileType(file.ext)]
  const head = (
    <span className="flex min-w-0 items-center gap-2 text-left">
      <Icon className="size-8 shrink-0 opacity-80" strokeWidth={1.5} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{file.name}</span>
        {file.size != null && <span className="text-xs opacity-70">{formatSize(file.size)}</span>}
      </span>
    </span>
  )

  if (file.ext !== "zip")
    return (
      <button type="button" onClick={() => openViewer(file)} className="flex min-w-0">
        {head}
      </button>
    )
  return (
    <Collapsible className="min-w-56">
      <CollapsibleTrigger className="group flex w-full items-center gap-2">
        {head}
        <ChevronDown className="ml-auto size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ZipList file={file} />
      </CollapsibleContent>
    </Collapsible>
  )
}
