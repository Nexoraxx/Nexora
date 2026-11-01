import { useEffect, useMemo } from "react";
import { FileTextIcon, XIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

// the preview strip: thumbnails for images, names for other files, each with its own remove button
// ponytail: no per-photo caption (PC's "Thêm mô tả"); the typed text goes as its own message
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (f: File) => void }) {
  const urls = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return (
    <div className="mb-1.5 flex flex-wrap gap-2 rounded-lg bg-white/80 dark:bg-card/90 dark:border dark:border-border/60 p-1.5 shadow-xs">
      {files.map((f, i) => (
        <div key={i} className="relative">
          {urls[i] ? (
            <img className="size-16 rounded object-cover" src={urls[i]!} alt={f.name} />
          ) : (
            <div className="flex h-16 w-32 items-center gap-1.5 rounded border bg-white dark:bg-card dark:border-border/60 px-2 text-xs">
              <FileTextIcon className="size-4 shrink-0" />
              <span className="line-clamp-2 break-all">{f.name}</span>
            </div>
          )}
          <Button variant="secondary" size="icon-xs" className="absolute -top-1.5 -right-1.5 rounded-full" title="Xóa" onClick={() => onRemove(f)}>
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  );
}
