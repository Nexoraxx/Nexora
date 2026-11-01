import { useEffect, useState } from "react"
import { MAX_TEXT_SIZE } from "@/app/file-viewer/constants/file-viewer.constants"
import type { ViewProps } from "@/app/file-viewer/models/file-viewer.model"

export const TextView = ({ src, onError }: ViewProps) => {
  const [text, setText] = useState<string>()
  const [cut, setCut] = useState(false)

  useEffect(() => {
    let live = true
    fetch(src, { headers: { Range: `bytes=0-${MAX_TEXT_SIZE - 1}` } })
      .then(async (r) => {
        const b = await r.arrayBuffer()
        if (!live) return
        // protocol asset trả tối đa 1000 KB mỗi range; tổng thật nằm sau "/" trong Content-Range
        setText(new TextDecoder().decode(b))
        setCut(Number(r.headers.get("content-range")?.split("/")[1]) > b.byteLength)
      })
      .catch(onError)
    return () => {
      live = false
    }
  }, [src])

  if (text === undefined) return null
  return (
    <pre className="min-h-full w-full self-start bg-background p-4 font-mono text-xs whitespace-pre-wrap">
      {text}
      {cut && <p className="mt-4 text-muted-foreground">Chỉ hiện phần đầu file. Mở bằng ứng dụng khác để xem hết.</p>}
    </pre>
  )
}
