import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { api } from "@/core/http/api";
import type { ChatTarget, OwnProfile, UserProfile } from "@/shared/types";
import { Report } from "@/app/profile/components/report/report";
import type { Page } from "@/app/profile/models/profile.model";
import { EditProfile } from "@/app/profile/components/edit/edit-profile";
import { AvatarPicker } from "@/app/profile/components/edit/avatar-picker";
import { AliasForm } from "@/app/profile/components/edit/alias-form";
import { Info } from "@/app/profile/components/info/profile-info";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/components/ui/dialog";

const TITLES: Record<Page, string> = {
  info: "Thông tin tài khoản",
  edit: "Cập nhật thông tin cá nhân",
  avatar: "Cập nhật ảnh đại diện",
  alias: "Đặt tên gợi nhớ",
  report: "Báo xấu tài khoản",
};

// Zalo PC's "Thông tin tài khoản": the account's own profile when userId is the account, anyone else's otherwise.
// Sub-pages (edit, avatar, alias) open inside the same dialog, with a back arrow, as on PC.
export function ProfileDialog({ accountId, userId, onClose, onChat }: { accountId: string; userId: string; onClose: () => void; onChat?: (t: ChatTarget) => void }) {
  const me = userId === accountId;
  const [profile, setProfile] = useState<OwnProfile | UserProfile>();
  const [page, setPage] = useState<Page>("info");
  const [error, setError] = useState<string>();
  const path = me ? `/accounts/${accountId}/profile` : `/accounts/${accountId}/users/${userId}`;
  const load = () => api<OwnProfile | UserProfile>(path).then(setProfile);
  const fail = (e: Error) => setError(e.message);

  useEffect(() => void load().catch(fail), [path]);

  // actions on someone else answer 204: refetch to show the new state
  const run = (p: Promise<unknown>) => (setError(undefined), p.then(load).catch(fail));
  const done = (p: OwnProfile) => (setProfile(p), setPage("info"), setError(undefined));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-h-[90vh] w-[400px] gap-0 overflow-y-auto p-0">
        <div className="flex h-12 items-center gap-1 px-3">
          {page !== "info" && (
            <Button variant="ghost" size="icon-sm" title="Quay lại" onClick={() => (setPage("info"), setError(undefined))}>
              <ArrowLeftIcon />
            </Button>
          )}
          <DialogTitle className="px-1">{TITLES[page]}</DialogTitle>
        </div>
        {error && <div className="mx-4 mb-2 rounded-md bg-red-50 px-3 py-2 whitespace-pre-line text-red-700">{error}</div>}
        {!profile ? (
          <p className="p-6 text-center text-xs text-muted-foreground">{error ? "" : "Đang tải…"}</p>
        ) : page === "edit" && me ? (
          <EditProfile accountId={accountId} profile={profile as OwnProfile} onDone={done} onError={setError} />
        ) : page === "avatar" && me ? (
          <AvatarPicker accountId={accountId} onDone={done} onError={setError} />
        ) : page === "alias" && !me ? (
          <AliasForm
            profile={profile as UserProfile}
            onSave={(alias) =>
              api(`/accounts/${accountId}/friends/${userId}/alias`, "PUT", { alias })
                .then(load)
                .then(() => (setPage("info"), setError(undefined)))
                .catch(fail)
            }
          />
        ) : page === "report" && !me ? (
          <Report
            accountId={accountId}
            targetId={userId}
            name={(profile as UserProfile).alias || profile.displayName}
            user={profile as UserProfile}
            onDone={() => (setPage("info"), void load().catch(fail))}
          />
        ) : (
          <Info me={me} profile={profile} onPage={setPage} accountId={accountId} run={run} onError={setError} onChat={onChat} />
        )}
      </DialogContent>
    </Dialog>
  );
}
