import { expect, test } from "bun:test";
import { addFilter, duration, filterQuery, insertFilter, insertVariable, matchFilters, matchVariables, problemsIn, variableQuery } from "../src/app/bulk-send/utils/bulk-send.utils";

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

  expect(problemsIn("{{ name }} {{nmae}} {{ten}} {{nmae}}")).toEqual(["Không có biến {{nmae}}, {{ten}}: kiểm tra chính tả, hoặc bấm các nút biến bên dưới ô soạn để chèn"]);
  // filters as the server takes them
  expect(problemsIn("{{name | upper | last}} {{pronoun|ông/bà|cap}} {{phone|or:chưa có}}")).toEqual([]);
  // worded as the server words them
  expect(problemsIn("{{name|uper}} {{name|ông/bà}}")).toEqual([
    'Không hiểu "uper" trong {{name|uper}}: xem các cách viết trong mục "Muốn viết hoa tên…" bên dưới ô soạn',
    '"ông/bà" chỉ dùng được với {{pronoun}} (xưng hô theo giới tính), không dùng với {{name}}',
  ]);
  expect([duration(20), duration(198 * 30), duration(3600)]).toEqual(["1 phút", "1 giờ 39 phút", "1 giờ"]);
});


test("a clicked filter joins the {{variable}} at the caret, else starts one", () => {
  // caret right after the token, or inside it
  expect(addFilter("Chào {{pronoun}}!", 15, "cap", "name")).toEqual({ text: "Chào {{pronoun | cap}}!", caret: 22 });
  expect(addFilter("{{ name | upper }}", 4, "last", "name").text).toBe("{{name | upper | last}}");
  // nowhere near one: a new token with the filter's usual variable
  expect(addFilter("Chào ", 5, "ông/bà", "pronoun")).toEqual({ text: "Chào {{pronoun | ông/bà}}", caret: 25 });
});

test('"|" inside a {{variable}} suggests its formats and writes the one picked', () => {
  expect(filterQuery("Chào {{name |", 13)).toEqual({ key: "name", query: "", start: 13 });
  expect(filterQuery("Chào {{ pronoun | ông/bà | c", 28)).toEqual({ key: "pronoun", query: "c", start: 27 });
  // outside a variable, or once it's closed: nothing to suggest
  expect(filterQuery("a | b", 5)).toBeUndefined();
  expect(filterQuery("{{name | upper}} |", 18)).toBeUndefined();
  // a nam/nữ pair is offered only for pronoun; formats are found by what they do, accents optional
  expect(matchFilters("name", "").some((f) => f.insert.includes("/"))).toBe(false);
  expect(matchFilters("pronoun", "").some((f) => f.insert === "ông/bà")).toBe(true);
  expect(matchFilters("name", "hoa").map((f) => f.insert)).toEqual(["cap", "upper", "title"]);
  expect(matchFilters("name", "ten goi").map((f) => f.insert)).toEqual(["last"]);
  // the token gets its "}}" when it isn't closed yet
  expect(insertFilter("{{name |", 8, 8, "upper")).toEqual({ text: "{{name |upper}}", caret: 15 });
  expect(insertFilter("{{name | up}} nhé", 9, 11, "upper")).toEqual({ text: "{{name | upper}} nhé", caret: 14 });
});
