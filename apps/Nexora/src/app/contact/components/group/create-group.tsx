import { useState } from "react";
import { CameraIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { ChatTarget } from "@/shared/types";
import { squareJpeg } from "@/app/profile/utils/profile.utils";
import type { Image } from "@/app/contact/models/group.model";
import { uploadGroupAvatar, pickImage } from "@/app/contact/utils/group.utils";
import { PickFriends } from "@/app/contact/components/picker/pick-friends";
import { MUTED } from "@/app/contact/constants/group.constants";
import { Input } from "@/shared/components/ui/input";

// "Tạo nhóm": name and avatar are optional (Zalo names an unnamed group after its members)
export function CreateGroup({ accountId, onCreated, onClose }: { accountId: string; onCreated: (t: ChatTarget) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [image, setImage] = useState<Image>();
  const [note, setNote] = useState<string>();
  const create = async (members: string[]) => {
    const g = await api<{ groupId: string; name: string }>(`/accounts/${accountId}/groups`, "POST", { name, members });
    // as on PC, a failed avatar doesn't undo the group
    if (image) await uploadGroupAvatar(accountId, g.groupId, image).catch(() => {});
    onCreated({ threadId: g.groupId, isGroup: true, name: g.name, avatar: null });
  };
  return (
    <PickFriends accountId={accountId} title="Tạo nhóm" confirm="Tạo nhóm" min={2} onConfirm={create} onClose={onClose}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          title="Cập nhật ảnh đại diện"
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted"
          onClick={() => pickImage((f) => squareJpeg(f).then((img) => (setImage(img), setNote(undefined)), (e) => setNote(e.message)))}
        >
          {image ? <img src={image.url} alt="" className="size-full object-cover" /> : <CameraIcon className="size-5 text-muted-foreground" />}
        </button>
        <Input placeholder="Nhập tên nhóm..." value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <p className={note ? "text-xs text-red-600" : MUTED}>{note ?? "Tạo nhóm từ 3 người trở lên"}</p>
    </PickFriends>
  );
}
