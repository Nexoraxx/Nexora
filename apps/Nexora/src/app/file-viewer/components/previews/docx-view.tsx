import { useEffect, useRef } from "react"
import { renderAsync } from "docx-preview"
import type { ViewProps } from "@/app/file-viewer/models/file-viewer.model"

export const DocxView = ({ src, zoom, onError }: ViewProps) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    fetch(src)
      .then((r) => r.blob())
      .then((b) => live && ref.current && renderAsync(b, ref.current))
      .catch(onError)
    return () => {
      live = false
    }
  }, [src])

  return <div ref={ref} style={{ zoom }} className="w-full self-start" />
}
