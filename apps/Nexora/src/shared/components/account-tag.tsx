import type { Account } from "@/shared/types";

// "Tất cả": each account's tag color, by its place in the account bar
const TAG_COLORS = ["#e11d48", "#0e7490", "#7c3aed", "#c2410c", "#15803d", "#db2777", "#1d4ed8", "#b45309"];

export function AccountTag({ name, color }: { name: string; color?: string }) {
  return (
    <span className="inline-flex max-w-28 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] leading-[18px] font-semibold" style={{ color, background: `${color}1a` }} title={name}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

// the tag of one of `accounts` (the whole bar, so colors match across views)
export function accountTag(accounts: Account[], id: string) {
  const i = Math.max(0, accounts.findIndex((a) => a.id === id));
  return <AccountTag name={accounts[i]?.name ?? id} color={TAG_COLORS[i % TAG_COLORS.length]} />;
}
