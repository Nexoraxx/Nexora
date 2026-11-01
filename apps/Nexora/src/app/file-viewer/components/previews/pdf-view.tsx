import "pdfjs-dist/web/pdf_viewer.css"
import { useEffect, useRef } from "react"
import * as pdfjs from "pdfjs-dist"
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import type { ViewProps } from "@/app/file-viewer/models/file-viewer.model"

// pdf_viewer.mjs đọc pdfjs từ globalThis nên phải gán trước khi import
pdfjs.GlobalWorkerOptions.workerSrc = worker
Object.assign(globalThis, { pdfjsLib: pdfjs })
const { EventBus, PDFLinkService, PDFViewer } = await import("pdfjs-dist/web/pdf_viewer.mjs")

export const PdfView = ({ src, zoom, onPage, onError }: ViewProps) => {
  const box = useRef<HTMLDivElement>(null)
  const viewer = useRef<InstanceType<typeof PDFViewer>>(null)

  useEffect(() => {
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const v = new PDFViewer({ container: box.current!, eventBus, linkService })
    linkService.setViewer(v)
    viewer.current = v
    eventBus.on("pagesinit", () => {
      v.currentScale = zoom
      onPage(1, v.pagesCount)
    })
    eventBus.on("pagechanging", (e: { pageNumber: number }) => onPage(e.pageNumber, v.pagesCount))
    let live = true
    let task: pdfjs.PDFDocumentLoadingTask | undefined
    fetch(src)
      .then((r) => r.arrayBuffer())
      .then((data) => {
        if (!live) return
        task = pdfjs.getDocument({ data })
        return task.promise
      })
      .then((doc) => {
        if (!doc || !live) return
        v.setDocument(doc)
        linkService.setDocument(doc)
      })
      .catch(onError)
    return () => {
      live = false
      task?.destroy()
    }
  }, [src])

  useEffect(() => {
    if (viewer.current?.pagesCount) viewer.current.currentScale = zoom
  }, [zoom])

  return (
    <div ref={box} className="absolute inset-0 overflow-auto">
      <div className="pdfViewer" />
    </div>
  )
}
