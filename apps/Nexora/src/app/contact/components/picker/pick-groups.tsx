import { useEffect, useState } from "react";
import { api } from "@/core/http/api";
import type { Group } from "@/shared/types";
import { collator } from "@/app/contact/constants/group.constants";
import { PickList } from "@/app/contact/components/picker/pick-list";

// Zalo PC's "Mời tham gia nhóm" of "Thêm vào nhóm": every group by name, the friend's mutual groups ticked and locked.
// Returns PC's line for each group that refused them.
export function PickGroups({
  accountId,
  userId,
  mutual,
  onDone,
  onClose,
}: {
  accountId: string;
  userId: string;
  mutual: string[];
  onDone: (errors: string[]) => void;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<Group[]>(`/accounts/${accountId}/groups`)
      .then((list) => setGroups(list.sort((a, b) => collator.compare(a.displayName, b.displayName))))
      .catch((e) => setError(e.message));
  }, []);
  const items = groups.map((g) => ({ id: g.userId, name: g.displayName, avatar: g.avatar, search: g.displayName }));
  return (
    <PickList
      title="Mời tham gia nhóm"
      placeholder="Tìm nhóm theo tên"
      confirm="Mời"
      min={1}
      items={items}
      taken={mutual}
      error={error}
      onConfirm={(groupIds) => api<{ errors: string[] }>(`/accounts/${accountId}/users/${userId}/groups`, "POST", { groupIds }).then((r) => onDone(r.errors))}
      onClose={onClose}
    />
  );
}
