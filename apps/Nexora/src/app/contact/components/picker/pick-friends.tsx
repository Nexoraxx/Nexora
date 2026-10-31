import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/core/http/api";
import type { Friend } from "@/shared/types";
import { collator } from "@/app/contact/constants/group.constants";
import { PickList } from "@/app/contact/components/picker/pick-list";

// Zalo PC's friend picker of "Tạo nhóm" and "Thêm thành viên"; members already in show ticked
export function PickFriends({
  accountId,
  title,
  confirm,
  min = 1,
  taken = [],
  initial,
  children,
  selectAll,
  skipBlocked,
  onConfirm,
  onClose,
}: {
  accountId: string;
  title: string;
  confirm: string;
  min?: number;
  taken?: string[];
  initial?: string[];
  children?: ReactNode;
  selectAll?: boolean;
  // friends this account blocked are left out
  skipBlocked?: boolean;
  onConfirm: (userIds: string[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<Friend[]>(`/accounts/${accountId}/friends`)
      .then((list) => setFriends(list.sort((a, b) => collator.compare(a.alias || a.displayName, b.alias || b.displayName))))
      .catch((e) => setError(e.message));
  }, []);
  const items = friends.filter((f) => !(skipBlocked && f.isBlocked)).map((f) => ({ id: f.userId, name: f.alias || f.displayName, avatar: f.avatar, search: `${f.alias ?? ""} ${f.displayName} ${f.phoneNumber ?? ""}` }));
  return (
    <PickList title={title} placeholder="Nhập tên, số điện thoại" confirm={confirm} min={min} items={items} taken={taken} initial={initial} error={error} selectAll={selectAll} onConfirm={onConfirm} onClose={onClose}>
      {children}
    </PickList>
  );
}
