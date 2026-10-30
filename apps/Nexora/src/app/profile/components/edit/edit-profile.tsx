import { useState } from "react";
import { api } from "@/core/http/api";
import type { OwnProfile } from "@/shared/types";
import { GENDER } from "@/app/profile/constants/profile.constants";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { Separator } from "@/shared/components/ui/separator";
import { Textarea } from "@/shared/components/ui/textarea";

// "DD/MM/YYYY" from Zalo, else the dob timestamp (seconds, local midnight)
const dateParts = (p: OwnProfile) => {
  const [d, m, y] = p.sdob.split("/").map(Number);
  if (y) return { d, m, y };
  const t = new Date(p.dob * 1000);
  return p.dob ? { d: t.getDate(), m: t.getMonth() + 1, y: t.getFullYear() } : { d: 1, m: 1, y: 2000 };
};
const pad = (n: number) => String(n).padStart(2, "0");

// Zalo PC: name (checked by Zalo, error 18035), gender radios, day/month/year dropdowns with years 1903 … this year − 14.
export function EditProfile({ accountId, profile, onDone, onError }: { accountId: string; profile: OwnProfile; onDone: (p: OwnProfile) => void; onError: (e: string) => void }) {
  const initial = { name: profile.displayName, gender: profile.gender ?? 0, ...dateParts(profile) };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const lastYear = new Date().getFullYear() - 14;
  const days = new Date(form.y, form.m, 0).getDate();
  const [bio, setBio] = useState(profile.status);
  const bioChanged = bio.trim() !== profile.status;
  const infoChanged = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // the bio goes out on its own call (PC has no editor for it; Zalo's mobile app sets it apart from the rest)
  const save = async () => {
    setSaving(true);
    try {
      const base = `/accounts/${accountId}/profile`;
      let p: OwnProfile | undefined;
      if (bioChanged) p = await api<OwnProfile>(`${base}/bio`, "PUT", { status: bio });
      if (infoChanged) p = await api<OwnProfile>(base, "PATCH", { name: form.name, gender: form.gender, dob: `${form.y}-${pad(form.m)}-${pad(Math.min(form.d, days))}` });
      if (p) onDone(p);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pick = (value: number, options: number[], onChange: (n: number) => void, label: string) => (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {options.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {pad(n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const range = (from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => (from <= to ? from + i : from - i));

  return (
    <form
      className="flex flex-col gap-4 px-4 pt-2 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-name">Tên hiển thị</Label>
        <Input id="profile-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        {!form.name.trim() && <span className="text-xs text-destructive">Bạn chưa nhập tên</span>}
      </div>
      <Separator />
      <h4 className="font-semibold">Thông tin cá nhân</h4>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-bio">Bio</Label>
        <Textarea id="profile-bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Giới tính</Label>
        <RadioGroup className="flex gap-6" value={String(form.gender)} onValueChange={(v) => set({ gender: Number(v) })}>
          {GENDER.map((g, i) => (
            <Label key={g} className="font-normal">
              <RadioGroupItem value={String(i)} /> {g}
            </Label>
          ))}
        </RadioGroup>
      </div>
      <div className="flex flex-col gap-2">
        <Label>Ngày sinh</Label>
        <div className="grid grid-cols-3 gap-2">
          {pick(Math.min(form.d, days), range(1, days), (d) => set({ d }), "Ngày")}
          {pick(form.m, range(1, 12), (m) => set({ m }), "Tháng")}
          {pick(form.y, range(lastYear, 1903), (y) => set({ y }), "Năm")}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={!(infoChanged || bioChanged) || !form.name.trim() || saving}>
          Cập nhật
        </Button>
      </div>
    </form>
  );
}
