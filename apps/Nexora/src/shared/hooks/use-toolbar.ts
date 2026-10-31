import { useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";

// where a tool sits: on the bar, grouped in its "Thêm" menu, or nowhere
export type Place = "bar" | "menu" | "hidden";
// places: where it may go when not everywhere (a tool that must stay reachable can't be hidden)
export type Tool = { id: string; label: string; icon: LucideIcon; place: Place; places?: Place[] };
// what the user changed; tools it doesn't name (added later) keep their default place, after the named ones
export type Layout = { order: string[]; place: Record<string, Place> };

const listeners = new Set<() => void>();
const saved = new Map<string, Layout | null>();
const storageKey = (bar: string) => `nexora.toolbar.${bar}`;

function read(bar: string) {
  if (!saved.has(bar)) {
    let layout: Layout | null = null;
    try {
      layout = JSON.parse(localStorage.getItem(storageKey(bar)) ?? "null");
    } catch {
      // a broken entry falls back to the defaults
    }
    saved.set(bar, layout);
  }
  return saved.get(bar)!;
}

// null restores the defaults; every open toolbar of that kind follows at once
export function saveLayout(bar: string, layout: Layout | null) {
  if (layout) localStorage.setItem(storageKey(bar), JSON.stringify(layout));
  else localStorage.removeItem(storageKey(bar));
  saved.set(bar, layout);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
// this device's layout of one toolbar ("composer", "message")
export const useLayout = (bar: string) => useSyncExternalStore(subscribe, () => read(bar));

// the tools in the user's order, each with the place it's in now
export function arrange(tools: Tool[], layout: Layout | null): Tool[] {
  const rank = (t: Tool) => {
    const i = layout?.order.indexOf(t.id) ?? -1;
    return i < 0 ? 1000 + tools.indexOf(t) : i;
  };
  const placeOf = (t: Tool) => {
    const p = layout?.place[t.id];
    return p && (!t.places || t.places.includes(p)) ? p : t.place;
  };
  return [...tools].sort((a, b) => rank(a) - rank(b)).map((t) => ({ ...t, place: placeOf(t) }));
}

// the layout after moving a tool to another place, or one step up/down among the tools sharing its place
export function edit(tools: Tool[], layout: Layout | null, id: string, change: { place?: Place; move?: -1 | 1 }): Layout {
  const list = arrange(tools, layout);
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return layout ?? { order: [], place: {} };
  if (change.move) {
    let j = i + change.move;
    while (j >= 0 && j < list.length && list[j].place !== list[i].place) j += change.move;
    if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  }
  if (change.place) list[i] = { ...list[i], place: change.place };
  return { order: list.map((t) => t.id), place: Object.fromEntries(list.map((t) => [t.id, t.place])) };
}
