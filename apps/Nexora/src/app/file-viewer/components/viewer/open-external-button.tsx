import { ExternalLink } from "lucide-react"
import { Button } from "@/shared/components/ui/button"
import type { ViewerFile } from "@/app/file-viewer/models/file-viewer.model"
import { openExternal, showError } from "@/app/file-viewer/services/file-viewer.service"

export const OpenExternalButton = ({ file }: { file: ViewerFile }) => {
  return (
    <Button variant="outline" onClick={() => openExternal(file).catch(showError)}>
      <ExternalLink /> Mở bằng ứng dụng khác
    </Button>
  )
}
