import { describe, expect, it } from "vitest";
import {
  type CoercibleField,
  coerceCaseFieldValue,
  defaultCaseFieldValue,
  isMissingValue,
} from "./caseFieldValueCoercion";

const field = (
  fieldType: string,
  extra: Partial<CoercibleField> = {}
): CoercibleField => ({ fieldName: "F", fieldType, ...extra });

const OPTIONS = [
  { id: 1, name: "Low" },
  { id: 2, name: "High", isDefault: true },
];

const ok = (f: CoercibleField, input: unknown) => {
  const result = coerceCaseFieldValue(f, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const rejects = (f: CoercibleField, input: unknown) =>
  expect(coerceCaseFieldValue(f, input).ok).toBe(false);

describe("coerceCaseFieldValue", () => {
  it("stores Checkbox values as booleans, including the string 'false'", () => {
    // Boolean("false") is true: the importer used to store it checked.
    const f = field("Checkbox");
    expect(ok(f, "false")).toBe(false);
    expect(ok(f, "TRUE")).toBe(true);
    expect(ok(f, 0)).toBe(false);
    expect(ok(f, true)).toBe(true);
    rejects(f, "maybe");
  });

  it("stores Integer and Number values as numbers and rejects the rest", () => {
    // parseInt(x) || 0 turned bad input into 0 and 3.9 into 3.
    expect(ok(field("Integer"), "5")).toBe(5);
    rejects(field("Integer"), 3.9);
    rejects(field("Integer"), "abc");
    expect(ok(field("Number"), "2.5")).toBe(2.5);
    rejects(field("Number"), "");
  });

  it("enforces a field's min and max", () => {
    const f = field("Integer", { minValue: 1, maxValue: 10 });
    expect(ok(f, 10)).toBe(10);
    rejects(f, 0);
    rejects(f, 11);
  });

  it("resolves Dropdown options by id or case-insensitive name", () => {
    const f = field("Dropdown", { fieldOptions: OPTIONS });
    expect(ok(f, 2)).toBe(2);
    expect(ok(f, "2")).toBe(2);
    expect(ok(f, " high ")).toBe(2);
    rejects(f, "Medium");
    rejects(f, 99);
  });

  it("stores Multi-Select values as an array of ids, wrapping a single value", () => {
    const f = field("Multi-Select", { fieldOptions: OPTIONS });
    expect(ok(f, ["Low", 2, "low"])).toEqual([1, 2]);
    expect(ok(f, "High")).toEqual([2]);
    rejects(f, ["Low", "Nope"]);
  });

  it("stores Text Long as a serialized document, converting Markdown", () => {
    const stored = JSON.parse(ok(field("Text Long"), "Use **care**") as string);
    expect(stored.type).toBe("doc");
    expect(JSON.stringify(stored)).toContain('"bold"');
    rejects(field("Text Long"), 5);
  });

  it("pins a bare Date to noon UTC so it reads as the same day everywhere", () => {
    expect(ok(field("Date"), "2026-09-29")).toBe("2026-09-29T12:00:00.000Z");
    expect(ok(field("Date"), "2026-09-29T08:30:00Z")).toBe(
      "2026-09-29T08:30:00.000Z"
    );
    rejects(field("Date"), "next tuesday");
  });

  it("accepts only http(s) Links", () => {
    expect(ok(field("Link"), "https://example.com/x")).toBe(
      "https://example.com/x"
    );
    rejects(field("Link"), "javascript:alert(1)");
    rejects(field("Link"), "not a url");
  });

  it("turns scalars into Text String and refuses objects", () => {
    expect(ok(field("Text String"), 12)).toBe("12");
    rejects(field("Text String"), { a: 1 });
  });

  it("refuses a value for a Steps field", () => {
    rejects(field("Steps"), "Do this");
  });
});

describe("defaultCaseFieldValue", () => {
  it("starts a field the way the Add Case form does", () => {
    expect(
      defaultCaseFieldValue(field("Dropdown", { fieldOptions: OPTIONS }))
    ).toBe(2);
    expect(defaultCaseFieldValue(field("Checkbox", { isChecked: true }))).toBe(
      true
    );
    expect(defaultCaseFieldValue(field("Checkbox"))).toBe(false);
    expect(
      defaultCaseFieldValue(field("Text String", { defaultValue: "n/a" }))
    ).toBe("n/a");
    expect(defaultCaseFieldValue(field("Text String"))).toBeUndefined();
    expect(defaultCaseFieldValue(field("Integer"))).toBeUndefined();
  });
});

describe("isMissingValue", () => {
  it("treats blank text, empty arrays and an empty document as missing", () => {
    expect(isMissingValue(field("Text String"), "  ")).toBe(true);
    expect(isMissingValue(field("Multi-Select"), [])).toBe(true);
    const empty = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(isMissingValue(field("Text Long"), empty)).toBe(true);
    expect(isMissingValue(field("Checkbox"), false)).toBe(false);
    expect(isMissingValue(field("Integer"), 0)).toBe(false);
  });
});
