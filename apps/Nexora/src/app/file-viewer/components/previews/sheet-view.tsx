import { useEffect, useState } from "react"
import { read, utils, type WorkBook } from "xlsx"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group"
import { MAX_SHEET_ROWS } from "@/app/file-viewer/constants/file-viewer.constants"
import type { ViewProps } from "@/app/file-viewer/models/file-viewer.model"
import { getFileType } from "@/app/file-viewer/utils/file-viewer.utils"

export const SheetView = ({ src, file, onError }: ViewProps) => {
  const [book, setBook] = useState<WorkBook>()
  const [sheet, setSheet] = useState("")

  useEffect(() => {
    let live = true
    fetch(src)
      .then((r) => r.arrayBuffer())
      .then((b) => {
        // csv/tsv không có BOM: SheetJS đoán sai bảng mã, nên tự giải mã UTF-8
        const wb = getFileType(file.ext) === "csv" ? read(new TextDecoder().decode(b), { type: "string", sheetRows: MAX_SHEET_ROWS }) : read(b, { sheetRows: MAX_SHEET_ROWS })
        if (!live) return
        setBook(wb)
        setSheet(wb.SheetNames[0])
      })
      .catch(onError)
    return () => {
      live = false
    }
  }, [src])

  if (!book) return null
  const rows = utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, defval: "", raw: false })
  const cols = Array.from({ length: Math.max(0, ...rows.map((r) => r.length)) }, (_, i) => i)

  return (
    <div className="flex w-full flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              {cols.map((c) => (
                <TableHead key={c}>{utils.encode_col(c)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableHead>{i + 1}</TableHead>
                {cols.map((c) => (
                  <TableCell key={c}>{String(r[c] ?? "")}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {book.SheetNames.length > 1 && (
        <ToggleGroup type="single" value={sheet} onValueChange={(v) => v && setSheet(v)} className="justify-start border-t p-1">
          {book.SheetNames.map((n) => (
            <ToggleGroupItem key={n} value={n} size="sm">
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </div>
  )
}
