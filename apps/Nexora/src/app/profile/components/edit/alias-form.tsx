import { useState } from "react";
import type { UserProfile } from "@/shared/types";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

export function AliasForm({ profile, onSave }: { profile: UserProfile; onSave: (alias: string) => void }) {
  const [alias, setAlias] = useState(profile.alias ?? "");
  return (
    <form
      className="flex flex-col gap-3 px-4 pt-2 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(alias.trim());
      }}
    >
      <p className="text-xs text-muted-foreground">Khó nhớ tên mọi người? Đổi tên gợi nhớ để tìm kiếm dễ dàng hơn.</p>
      <Input autoFocus value={alias} placeholder={profile.displayName} onChange={(e) => setAlias(e.target.value)} />
      <div className="flex justify-end">
        <Button type="submit">Lưu</Button>
      </div>
    </form>
  );
}
