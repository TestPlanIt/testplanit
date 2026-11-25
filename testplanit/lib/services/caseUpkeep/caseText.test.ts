import { describe, expect, it } from "vitest";
import type { FieldMapping } from "~/lib/services/jira-panel-generation";
import { readableFieldValue, toUpkeepCase } from "./caseText";

const field = (
  fieldType: string,
  extra: Partial<FieldMapping> = {}
): FieldMapping => ({
  fieldName: fieldType,
  caseFieldId: 1,
  fieldType,
  ...extra,
});

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const options = [
  { id: 10, name: "High" },
  { id: 11, name: "Low" },
];

describe("readableFieldValue", () => {
  it("reads rich text as plain text, whether stored as a document or a string", () => {
    expect(readableFieldValue(field("Text Long"), doc("Log in first"))).toBe(
      "Log in first"
    );
    expect(
      readableFieldValue(field("Text Long"), JSON.stringify(doc("Log in")))
    ).toBe("Log in");
  });

  it("reads a dropdown and a multi-select as option names", () => {
    expect(
      readableFieldValue(field("Dropdown", { fieldOptions: options }), 10)
    ).toBe("High");
    expect(
      readableFieldValue(
        field("Multi-Select", { fieldOptions: options }),
        [11, 10]
      )
    ).toEqual(["Low", "High"]);
  });

  it("drops an option that no longer exists", () => {
    expect(
      readableFieldValue(field("Dropdown", { fieldOptions: options }), 99)
    ).toBeUndefined();
    expect(
      readableFieldValue(
        field("Multi-Select", { fieldOptions: options }),
        [99, 10]
      )
    ).toEqual(["High"]);
    expect(
      readableFieldValue(field("Multi-Select", { fieldOptions: options }), [99])
    ).toBeUndefined();
    expect(
      readableFieldValue(field("Multi-Select", { fieldOptions: options }), 10)
    ).toBeUndefined();
  });

  it("passes numbers and checkboxes through, and shortens a date to its day", () => {
    expect(readableFieldValue(field("Integer"), 3)).toBe(3);
    expect(readableFieldValue(field("Number"), 1.5)).toBe(1.5);
    expect(readableFieldValue(field("Checkbox"), false)).toBe(false);
    expect(readableFieldValue(field("Date"), "2026-11-24T12:00:00.000Z")).toBe(
      "2026-11-24"
    );
    expect(readableFieldValue(field("Date"), 5)).toBeUndefined();
  });

  it("reads short text and links trimmed", () => {
    expect(readableFieldValue(field("Text String"), "  Smoke ")).toBe("Smoke");
    expect(readableFieldValue(field("Link"), "https://example.com")).toBe(
      "https://example.com"
    );
  });

  it("says nothing for an empty value or a type it does not know", () => {
    expect(readableFieldValue(field("Text String"), null)).toBeUndefined();
    expect(readableFieldValue(field("Text String"), "  ")).toBeUndefined();
    expect(readableFieldValue(field("Text Long"), doc(" "))).toBeUndefined();
    expect(readableFieldValue(field("Steps"), [])).toBeUndefined();
  });
});

describe("toUpkeepCase", () => {
  const mappings: FieldMapping[] = [
    {
      fieldName: "Priority",
      caseFieldId: 5,
      fieldType: "Dropdown",
      fieldOptions: options,
    },
    { fieldName: "Preconditions", caseFieldId: 6, fieldType: "Text Long" },
    { fieldName: "Notes", caseFieldId: 7, fieldType: "Text String" },
  ];

  it("gives the name, the fields that say something, and the steps as text", () => {
    expect(
      toUpkeepCase(
        {
          id: 12,
          name: "Totals add up",
          caseFieldValues: [
            { fieldId: 5, value: 11 },
            { fieldId: 6, value: doc("Cart has two items") },
            { fieldId: 99, value: "not on this template" },
          ],
          steps: [
            {
              step: doc("Open the cart"),
              expectedResult: doc("Total is shown"),
              sharedStepGroupId: null,
            },
          ],
        },
        mappings
      )
    ).toEqual({
      id: 12,
      name: "Totals add up",
      fieldValues: { Priority: "Low", Preconditions: "Cart has two items" },
      steps: [{ step: "Open the cart", expectedResult: "Total is shown" }],
      stepsFixed: false,
    });
  });

  it("marks the steps fixed when any step belongs to a shared group", () => {
    const result = toUpkeepCase(
      {
        id: 12,
        name: "Totals",
        caseFieldValues: [],
        steps: [
          { step: doc("A"), expectedResult: null, sharedStepGroupId: null },
          { step: doc("B"), expectedResult: null, sharedStepGroupId: 4 },
        ],
      },
      mappings
    );
    expect(result.stepsFixed).toBe(true);
    expect(result.steps[0]).toEqual({ step: "A", expectedResult: "" });
  });
});
