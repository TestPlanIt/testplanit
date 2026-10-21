import { describe, expect, it } from "vitest";

import { emptyEditorContent } from "~/app/constants";
import {
  carriedFieldSources,
  caseFieldValueChanged,
  fieldsDroppedBySwitch,
  isEmptyFieldValue,
  templateFieldDefaults,
} from "./caseTemplateSwitch";

const field = (id: number, type = "Text String", displayName = `F${id}`) => ({
  caseField: { id, displayName, type: { type } },
});

describe("carriedFieldSources", () => {
  it("carries a field both templates share", () => {
    const sources = carriedFieldSources(
      [field(1), field(2)],
      [field(2), field(3)]
    );
    expect([...sources]).toEqual([[2, 2]]);
  });

  it("moves the steps to a different Steps field", () => {
    const sources = carriedFieldSources(
      [field(1), field(5, "Steps")],
      [field(1), field(9, "Steps")]
    );
    expect(sources.get(9)).toBe(5);
    expect(sources.get(1)).toBe(1);
  });

  it("keeps the steps on a Steps field the next template shares", () => {
    const sources = carriedFieldSources(
      [field(5, "Steps")],
      [field(9, "Steps"), field(5, "Steps")]
    );
    expect(sources.get(5)).toBe(5);
    expect(sources.has(9)).toBe(false);
  });

  it("gives the steps to one Steps field only", () => {
    const sources = carriedFieldSources(
      [field(5, "Steps")],
      [field(9, "Steps"), field(10, "Steps")]
    );
    expect(sources.get(9)).toBe(5);
    expect(sources.has(10)).toBe(false);
  });

  it("carries nothing from no template", () => {
    expect(carriedFieldSources([], [field(1)]).size).toBe(0);
  });
});

describe("fieldsDroppedBySwitch", () => {
  it("returns the fields the next template has no place for", () => {
    const dropped = fieldsDroppedBySwitch(
      [field(1), field(2), field(5, "Steps")],
      [field(2), field(9, "Steps")]
    );
    expect(dropped.map((f) => f.caseField.id)).toEqual([1]);
  });

  it("drops the steps when the next template has no Steps field", () => {
    const dropped = fieldsDroppedBySwitch([field(5, "Steps")], [field(1)]);
    expect(dropped.map((f) => f.caseField.id)).toEqual([5]);
  });
});

describe("caseFieldValueChanged", () => {
  it("treats empty values of any shape as unchanged", () => {
    expect(caseFieldValueChanged(undefined, "")).toBe(false);
    expect(caseFieldValueChanged([], undefined)).toBe(false);
    expect(caseFieldValueChanged(false, undefined)).toBe(false);
    expect(
      caseFieldValueChanged(JSON.stringify(emptyEditorContent), undefined)
    ).toBe(false);
  });

  it("treats a value equal to the baseline as unchanged", () => {
    expect(caseFieldValueChanged("default text", "default text")).toBe(false);
    expect(caseFieldValueChanged(3, 3)).toBe(false);
    expect(caseFieldValueChanged([1, 2], [1, 2])).toBe(false);
    expect(
      caseFieldValueChanged(new Date("2026-01-02"), new Date("2026-01-02"))
    ).toBe(false);
  });

  it("reports entered values", () => {
    expect(caseFieldValueChanged("typed", "")).toBe(true);
    expect(caseFieldValueChanged([{ step: {} }], [])).toBe(true);
    expect(caseFieldValueChanged(true, false)).toBe(true);
    expect(caseFieldValueChanged(0, undefined)).toBe(true);
    expect(caseFieldValueChanged(new Date("2026-01-02"), undefined)).toBe(true);
  });

  it("reports a cleared value that had a baseline", () => {
    expect(caseFieldValueChanged("", "saved text")).toBe(true);
    expect(caseFieldValueChanged(false, true)).toBe(true);
  });

  it("reports rich text that differs from the baseline", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    });
    expect(caseFieldValueChanged(doc, JSON.stringify(emptyEditorContent))).toBe(
      true
    );
  });
});

describe("templateFieldDefaults", () => {
  const option = (id: number, extra: Record<string, unknown> = {}) => ({
    fieldOption: { id, isDefault: false, isEnabled: true, ...extra },
  });

  it("picks the default option of a dropdown", () => {
    const defaults = templateFieldDefaults([
      {
        caseField: {
          ...field(1, "Dropdown").caseField,
          fieldOptions: [option(10), option(11, { isDefault: true })],
        },
      },
    ]);
    expect(defaults["1"]).toBe(11);
  });

  it("skips a default option that is disabled or deleted", () => {
    const defaults = templateFieldDefaults([
      {
        caseField: {
          ...field(1, "Dropdown").caseField,
          fieldOptions: [option(10, { isDefault: true, isEnabled: false })],
        },
      },
      {
        caseField: {
          ...field(2, "Dropdown").caseField,
          fieldOptions: [option(20, { isDefault: true, isDeleted: true })],
        },
      },
    ]);
    expect(defaults["1"]).toBeUndefined();
    expect(defaults["2"]).toBeUndefined();
  });

  it("uses the field's own defaults for text and checkbox fields", () => {
    const defaults = templateFieldDefaults([
      { caseField: { ...field(1, "Checkbox").caseField, isChecked: true } },
      {
        caseField: { ...field(2, "Text String").caseField, defaultValue: "x" },
      },
      { caseField: field(3, "Text Long").caseField },
      { caseField: field(4, "Steps").caseField },
    ]);
    expect(defaults["1"]).toBe(true);
    expect(defaults["2"]).toBe("x");
    expect(defaults["3"]).toBe(JSON.stringify(emptyEditorContent));
    expect(defaults["4"]).toEqual([]);
  });
});

describe("isEmptyFieldValue", () => {
  it("treats blank values of every field shape as empty", () => {
    for (const value of [
      undefined,
      null,
      "",
      [],
      false,
      JSON.stringify(emptyEditorContent),
    ]) {
      expect(isEmptyFieldValue(value)).toBe(true);
    }
  });

  it("keeps real values, zero included", () => {
    for (const value of [0, 12, true, "text", [3], new Date()]) {
      expect(isEmptyFieldValue(value)).toBe(false);
    }
  });
});
