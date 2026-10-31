import { expect, test } from "bun:test";
import { arrange, edit, type Tool } from "../src/shared/hooks/use-toolbar";

const icon = (() => null) as unknown as Tool["icon"];
const TOOLS: Tool[] = [
  { id: "a", label: "A", icon, place: "bar" },
  { id: "b", label: "B", icon, place: "bar" },
  { id: "c", label: "C", icon, place: "menu" },
  { id: "d", label: "D", icon, place: "bar" },
];
const ids = (tools: Tool[], place?: string) => tools.filter((t) => !place || t.place === place).map((t) => t.id);

test("toolbar layout: defaults, moves within a place, place changes, tools added later", () => {
  expect(ids(arrange(TOOLS, null), "bar")).toEqual(["a", "b", "d"]);

  // "d" up one among the bar tools skips "c", which sits in the menu
  let layout = edit(TOOLS, null, "d", { move: -1 });
  expect(ids(arrange(TOOLS, layout), "bar")).toEqual(["a", "d", "b"]);
  expect(ids(arrange(TOOLS, layout), "menu")).toEqual(["c"]);

  // already first: nothing moves
  expect(ids(arrange(TOOLS, edit(TOOLS, layout, "a", { move: -1 })), "bar")).toEqual(["a", "d", "b"]);

  // grouped into the menu, then hidden
  layout = edit(TOOLS, layout, "a", { place: "menu" });
  expect(ids(arrange(TOOLS, layout), "bar")).toEqual(["d", "b"]);
  expect(ids(arrange(TOOLS, layout), "menu")).toEqual(["a", "c"]);
  layout = edit(TOOLS, layout, "c", { place: "hidden" });
  expect(ids(arrange(TOOLS, layout), "hidden")).toEqual(["c"]);

  // a tool that must stay reachable ignores a place it may not take ("Tin nhắn" can't be hidden)
  const locked = TOOLS.map((t) => (t.id === "a" ? { ...t, places: ["bar", "menu"] as Tool["place"][] } : t));
  expect(arrange(locked, edit(locked, null, "a", { place: "hidden" })).find((t) => t.id === "a")!.place).toBe("bar");

  // a tool the saved layout never heard of keeps its default place, after the others
  const later = [...TOOLS, { id: "e", label: "E", icon, place: "bar" as const }];
  expect(ids(arrange(later, layout), "bar")).toEqual(["d", "b", "e"]);
});
