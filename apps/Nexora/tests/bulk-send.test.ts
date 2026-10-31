import { expect, test } from "bun:test";
import { duration, insertVariable, matchVariables, unknownVariables, variableQuery } from "../src/app/bulk-send/utils/bulk-send.utils";

test("bulk send: {{ suggestions find the typed key, insert replaces it, unknown keys are caught", () => {
  // one brace is enough, two work too
  expect(variableQuery("Chào {", 6)).toEqual({ query: "", start: 5 });
  expect(variableQuery("Chào {pro", 9)).toEqual({ query: "pro", start: 5 });
  expect(variableQuery("Chào {{", 7)).toEqual({ query: "", start: 5 });
  expect(variableQuery("Chào {{ pro", 11)).toEqual({ query: "pro", start: 5 });
  expect(variableQuery("Chào {{name}} ", 14)).toBeUndefined();
  expect(variableQuery("Chào {{tên", 10)).toEqual({ query: "tên", start: 5 });
  expect(matchVariables("pro").map((v) => v.key)).toEqual(["pronoun"]);
  expect(matchVariables("tên").map((v) => v.key)).toEqual(["name", "alias", "me"]);
  expect(matchVariables("").length).toBe(5);

  expect(insertVariable("Chào {{pro bạn", 5, 10, "pronoun")).toEqual({ text: "Chào {{pronoun}} bạn", caret: 16 });
  // typed ahead: "{{na}}" with the caret before "}}"
  expect(insertVariable("A {{na}}!", 2, 6, "name")).toEqual({ text: "A {{name}}!", caret: 10 });
  expect(insertVariable("A {na}!", 2, 5, "name")).toEqual({ text: "A {{name}}!", caret: 10 });

  expect(unknownVariables("{{ name }} {{nmae}} {{ten}} {{nmae}}")).toEqual(["nmae", "ten"]);
  expect([duration(20), duration(198 * 30), duration(3600)]).toEqual(["1 phút", "1 giờ 39 phút", "1 giờ"]);
});

