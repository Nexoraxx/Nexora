import type { ReactNode } from "react"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/components/ui/empty"
import { FILE_ICONS } from "@/app/file-viewer/constants/file-viewer.constants"
import type { ViewerFile } from "@/app/file-viewer/models/file-viewer.model"
import { getFileType } from "@/app/file-viewer/utils/file-viewer.utils"

type Props = { file?: ViewerFile; title: string; description?: string; children?: ReactNode }

export const FileStatus = ({ file, title, description, children }: Props) => {
  const Icon = file && FILE_ICONS[getFileType(file.ext)]
  return (
    <Empty>
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription className="break-all">{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent className="flex-row justify-center">{children}</EmptyContent>}
    </Empty>
  )
}
