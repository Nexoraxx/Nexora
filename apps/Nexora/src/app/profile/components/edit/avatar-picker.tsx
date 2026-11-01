import { useEffect, useRef, useState } from "react";
import { api } from "@/core/http/api";
import type { AvatarPhoto, OwnProfile } from "@/shared/types";
import { squareJpeg } from "@/app/profile/utils/profile.utils";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/shadcn";
import { Img } from "@/shared/components/img";

// "Cập nhật ảnh đại diện": upload from the computer, or pick one of "Ảnh đại diện của tôi" (the first is the current one).
export function AvatarPicker({ accountId, onDone, onError }: { accountId: string; onDone: (p: OwnProfile) => void; onError: (e: string) => void }) {
  const [photos, setPhotos] = useState<AvatarPhoto[]>();
  const [upload, setUpload] = useState<Awaited<ReturnType<typeof squareJpeg>>>();
  const [picked, setPicked] = useState<AvatarPhoto>();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const base = `/accounts/${accountId}/profile`;

  const load = () =>
    api<AvatarPhoto[]>(`${base}/avatars`)
      .then(setPhotos)
      .catch((e) => (setPhotos([]), onError(e.message)));
  useEffect(() => void load(), []);
  useEffect(() => () => void (upload && URL.revokeObjectURL(upload.url)), [upload]);

  const go = (p: Promise<unknown>) => {
    setBusy(true);
    return p.catch((e) => onError(e.message)).finally(() => setBusy(false));
  };

  const send = () => {
    if (!upload) return;
    const form = new FormData();
    form.append("file", upload.blob, "avatar.jpg");
    form.append("width", String(upload.size));
    form.append("height", String(upload.size));
    go(api<OwnProfile>(`${base}/avatar`, "POST", form).then(onDone));
  };

  if (upload)
    return (
      <div className="flex flex-col items-center gap-4 px-4 pt-2 pb-4">
        <img className="size-60 rounded-full object-cover" src={upload.url} alt="Ảnh đại diện mới" />
        <div className="flex gap-2 self-end">
          <Button variant="outline" onClick={() => setUpload(undefined)}>
            Hủy
          </Button>
          <Button disabled={busy} onClick={send}>
            Cập nhật
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
      <Button variant="secondary" onClick={() => file.current?.click()}>
        Tải lên từ máy tính
      </Button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) squareJpeg(f).then(setUpload, (err: Error) => onError(err.message));
        }}
      />
      <h4 className="font-semibold">Ảnh đại diện của tôi</h4>
      {!photos ? (
        <p className="text-xs text-muted-foreground">Đang tải…</p>
      ) : !photos.length ? (
        <p className="text-xs text-muted-foreground">Bạn chưa cập nhật ảnh đại diện nào</p>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {photos.map((ph) => (
            <button
              key={ph.photoId}
              className={cn("aspect-square overflow-hidden rounded-md ring-primary", picked?.photoId === ph.photoId && "ring-3")}
              onClick={() => setPicked((cur) => (cur?.photoId === ph.photoId ? undefined : ph))}
            >
              <Img className="size-full object-cover" src={ph.thumbnail || ph.url} />
            </button>
          ))}
        </div>
      )}
      {picked && (
        <div className="flex justify-end gap-2">
          {picked.photoId !== photos?.[0]?.photoId && (
            <>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => go(api(`${base}/avatars/${picked.photoId}`, "DELETE").then(() => (setPicked(undefined), load())))}
              >
                Xóa ảnh
              </Button>
              <Button disabled={busy} onClick={() => go(api<OwnProfile>(`${base}/avatar`, "PUT", { photoId: picked.photoId }).then(onDone))}>
                Đặt làm ảnh đại diện
              </Button>
            </>
          )}
          {picked.photoId === photos?.[0]?.photoId && <span className="text-xs text-muted-foreground">Ảnh đại diện hiện tại</span>}
        </div>
      )}
    </div>
  );
}
