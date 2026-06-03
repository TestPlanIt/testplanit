import { describe, expect, it } from "vitest";

import { pickInlinePayload, templateHasStepsField } from "./inlineParamsGate";

describe("templateHasStepsField", () => {
  it("returns true when caseFields contains a field with displayName 'Steps'", () => {
    expect(
      templateHasStepsField({
        caseFields: [
          { caseField: { displayName: "Name" } },
          { caseField: { displayName: "Steps" } },
        ],
      })
    ).toBe(true);
  });

  it("returns false when no caseField has displayName 'Steps'", () => {
    expect(
      templateHasStepsField({
        caseFields: [
          { caseField: { displayName: "Name" } },
          { caseField: { displayName: "Description" } },
        ],
      })
    ).toBe(false);
  });

  it("is case-sensitive on displayName (matches the canonical 'Steps')", () => {
    expect(
      templateHasStepsField({
        caseFields: [{ caseField: { displayName: "steps" } }],
      })
    ).toBe(false);
    expect(
      templateHasStepsField({
        caseFields: [{ caseField: { displayName: "STEPS" } }],
      })
    ).toBe(false);
  });

  it("returns false for null / undefined templates (defensive)", () => {
    expect(templateHasStepsField(null)).toBe(false);
    expect(templateHasStepsField(undefined)).toBe(false);
  });

  it("returns false when caseFields is missing or empty", () => {
    expect(templateHasStepsField({})).toBe(false);
    expect(templateHasStepsField({ caseFields: null })).toBe(false);
    expect(templateHasStepsField({ caseFields: [] })).toBe(false);
  });

  it("ignores caseFields entries with no nested caseField", () => {
    expect(
      templateHasStepsField({
        caseFields: [
          { caseField: null },
          { caseField: { displayName: undefined } },
        ],
      })
    ).toBe(false);
  });
});

describe("pickInlinePayload", () => {
  it("returns both undefined when no parameters declared (non-parameterized branch)", () => {
    expect(pickInlinePayload([], [])).toEqual({
      parameters: undefined,
      datasetRows: undefined,
    });
  });

  it("returns both undefined when parameters declared but every name is empty / whitespace", () => {
    expect(
      pickInlinePayload(
        [
          { name: "", type: "STRING" },
          { name: "   ", type: "INTEGER" },
        ],
        [{ rowIndex: 0, values: {} }]
      )
    ).toEqual({ parameters: undefined, datasetRows: undefined });
  });

  it("forwards trimmed (non-empty-name) parameters and rows when at least one valid param exists", () => {
    const params = [
      { name: "user", type: "STRING" as const },
      { name: "", type: "INTEGER" as const },
    ];
    const rows = [{ rowIndex: 0, label: "happy", values: { user: "alice" } }];
    const out = pickInlinePayload(params, rows);
    expect(out.parameters).toEqual([{ name: "user", type: "STRING" }]);
    expect(out.datasetRows).toBe(rows);
  });

  it("does not mutate the input arrays", () => {
    const params = [{ name: "a", type: "STRING" as const }];
    const rows = [{ rowIndex: 0, values: { a: "x" } }];
    pickInlinePayload(params, rows);
    expect(params).toEqual([{ name: "a", type: "STRING" }]);
    expect(rows).toEqual([{ rowIndex: 0, values: { a: "x" } }]);
  });

  it("forwards rows even when there are zero rows (parameters declared but no rows yet is a valid intermediate state)", () => {
    const params = [{ name: "a", type: "STRING" as const }];
    const out = pickInlinePayload(params, []);
    expect(out.parameters).toEqual([{ name: "a", type: "STRING" }]);
    expect(out.datasetRows).toEqual([]);
  });
});
