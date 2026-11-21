import { describe, expect, it } from "vitest";
import { isCaseFieldValueEmpty } from "./isCaseFieldValueEmpty";

describe("isCaseFieldValueEmpty", () => {
  it("shows a Multi-Select field that has options selected", () => {
    expect(isCaseFieldValueEmpty("Multi-Select", [191, 193])).toBe(false);
  });

  it("hides a Multi-Select field with nothing selected", () => {
    expect(isCaseFieldValueEmpty("Multi-Select", [])).toBe(true);
    expect(isCaseFieldValueEmpty("Multi-Select", null)).toBe(true);
    expect(isCaseFieldValueEmpty("Multi-Select", undefined)).toBe(true);
  });

  it("judges Steps by the number of rows", () => {
    expect(isCaseFieldValueEmpty("Steps", [{ id: 1 }])).toBe(false);
    expect(isCaseFieldValueEmpty("Steps", [])).toBe(true);
    expect(isCaseFieldValueEmpty("Steps", undefined)).toBe(true);
  });

  it("judges other fields by their content", () => {
    expect(isCaseFieldValueEmpty("Text String", "REQ-1")).toBe(false);
    expect(isCaseFieldValueEmpty("Text String", "  ")).toBe(true);
    expect(isCaseFieldValueEmpty("Dropdown", 12)).toBe(false);
    expect(isCaseFieldValueEmpty("Checkbox", false)).toBe(false);
    expect(isCaseFieldValueEmpty("Dropdown", null)).toBe(true);
    expect(
      isCaseFieldValueEmpty(
        "Text Long",
        JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })
      )
    ).toBe(true);
  });
});
