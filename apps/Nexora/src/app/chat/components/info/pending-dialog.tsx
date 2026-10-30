import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { GroupPerson } from "@/shared/types";
import { PeopleDialog } from "@/app/chat/components/info/people-dialog";
import { Button } from "@/shared/components/ui/button";

// "Các yêu cầu cần được phê duyệt": owner and deputies let join requests in or not
export function PendingDialog({ base, onChanged, onClose }: { base: string; onChanged: () => void; onClose: () => void }) {
  const [people, setPeople] = useState<GroupPerson[]>();
  const [note, setNote] = useState<string>();
  const load = () =>
    api<GroupPerson[]>(`${base}/pending`)
      .then(setPeople)
      .catch((e) => setNote(e.message));
  useEffect(() => void load(), []);
  const review = (userId: string, approve: boolean) =>
    api<{ errors: string[] }>(`${base}/pending`, "POST", { userIds: [userId], approve })
      .then((r) => (setNote(r.errors.join("\n") || undefined), load(), onChanged()))
      .catch((e) => setNote(e.message));
  return (
    <PeopleDialog
      title="Các yêu cầu cần được phê duyệt"
      empty="Không còn yêu cầu tham gia nhóm nào"
      people={people}
      note={note}
      actions={(p) => (
        <>
          <Button variant="outline" size="sm" onClick={() => review(p.userId, false)}>
            Từ chối
          </Button>
          <Button size="sm" onClick={() => review(p.userId, true)}>
            Duyệt
          </Button>
        </>
      )}
      onClose={onClose}
    />
  );
}
