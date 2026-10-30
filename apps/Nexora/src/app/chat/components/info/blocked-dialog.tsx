import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { GroupPerson } from "@/shared/types";
import { PeopleDialog } from "@/app/chat/components/info/people-dialog";
import { Button } from "@/shared/components/ui/button";

// "Chặn khỏi nhóm": who can't rejoin until unblocked or added back
export function BlockedDialog({ base, onClose }: { base: string; onClose: () => void }) {
  const [people, setPeople] = useState<GroupPerson[]>();
  const [note, setNote] = useState<string>();
  const load = () =>
    api<GroupPerson[]>(`${base}/blocked`)
      .then(setPeople)
      .catch((e) => setNote(e.message));
  useEffect(() => void load(), []);
  return (
    <PeopleDialog
      title={`Thành viên bị chặn (${people?.length ?? 0})`}
      description="Những người đã bị chặn không thể tham gia lại nhóm, trừ khi được trưởng, phó nhóm bỏ chặn hoặc thêm lại vào nhóm."
      empty="Chưa có thành viên bị chặn"
      people={people}
      note={note}
      actions={(p) => (
        <Button variant="outline" size="sm" onClick={() => api(`${base}/blocked/${p.userId}`, "DELETE").then(load, (e) => setNote(e.message))}>
          Bỏ chặn
        </Button>
      )}
      onClose={onClose}
    />
  );
}
