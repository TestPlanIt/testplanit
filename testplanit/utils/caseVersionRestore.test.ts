import { describe, expect, it } from "vitest";
import { emptyEditorContent } from "~/app/constants";
import {
  caseVersionToFormValues,
  type RestorableVersion,
  type RestoreTemplateField,
} from "./caseVersionRestore";

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const field = (
  id: number,
  displayName: string | null,
  systemName: string,
  type = "Text String"
): RestoreTemplateField => ({
  caseField: { id, displayName, systemName, type: { type } },
});

const version = (
  overrides: Partial<RestorableVersion> = {}
): RestorableVersion => ({
  name: "Old name",
  estimate: 90,
  steps: [{ step: doc("Do it"), expectedResult: doc("It is done") }],
  tags: ["smoke", "gone"],
  issues: [
    { id: 1, name: "A-1" },
    { id: 2, name: "A-2" },
  ],
  caseFieldVersionValues: [
    { field: "Priority", value: 12 },
    { field: "due_date", value: "2026-01-02T00:00:00.000Z" },
    { field: "Removed field", value: "x" },
    { field: "Empty removed field", value: null },
  ],
  ...overrides,
});

const restore = (overrides: Partial<RestorableVersion> = {}) =>
  caseVersionToFormValues({
    version: version(overrides),
    templateFields: [
      field(7, "Priority", "priority", "Dropdown"),
      field(8, null, "due_date", "Date"),
      field(9, "Notes", "notes"),
      field(10, "Steps", "steps", "Steps"),
    ],
    tags: [{ id: 3, name: "smoke" }],
    linkableIssueIds: [2],
    formatEstimate: (seconds) => `${seconds}s`,
  });

describe("caseVersionToFormValues", () => {
  it("loads the name and the estimate", () => {
    const { values } = restore();
    expect(values.name).toBe("Old name");
    expect(values.estimate).toBe("90s");
    expect(restore({ estimate: null }).values.estimate).toBe("");
  });

  it("leaves state, folder, automated flag and template to the case", () => {
    const { values } = restore();
    for (const key of ["workflowId", "folderId", "automated", "templateId"]) {
      expect(key in values).toBe(false);
    }
  });

  it("loads the steps as steps of the case itself", () => {
    expect(restore().values.steps).toEqual([
      {
        step: doc("Do it"),
        expectedResult: doc("It is done"),
        isShared: false,
      },
    ]);
  });

  it("reads steps stored as a JSON string and fills a missing expected result", () => {
    const { values } = restore({
      steps: JSON.stringify([{ step: JSON.stringify(doc("One")) }]),
    });
    expect(values.steps).toEqual([
      {
        step: doc("One"),
        expectedResult: emptyEditorContent,
        isShared: false,
      },
    ]);
  });

  it("loads no steps when the version had none", () => {
    expect(restore({ steps: null }).values.steps).toEqual([]);
  });

  it("maps tag names to the tags that still exist", () => {
    const { values, skipped } = restore();
    expect(values.tags).toEqual([3]);
    expect(skipped.tags).toEqual(["gone"]);
  });

  it("keeps only the issues the Issues field can still hold", () => {
    const { values, skipped } = restore();
    expect(values.issues).toEqual([2]);
    expect(skipped.issues).toBe(1);
  });

  it("matches field values by display name, then system name", () => {
    const { values } = restore();
    expect(values["7"]).toBe(12);
    expect(values["8"]).toEqual(new Date("2026-01-02T00:00:00.000Z"));
  });

  it("clears a template field the version had no value for", () => {
    const { values } = restore();
    expect("9" in values).toBe(true);
    expect(values["9"]).toBeUndefined();
  });

  it("never loads the Steps field as a field value", () => {
    expect("10" in restore().values).toBe(false);
  });

  it("leaves the field values alone when the version recorded none", () => {
    const { values, skipped } = restore({ caseFieldVersionValues: [] });
    for (const key of ["7", "8", "9"]) {
      expect(key in values).toBe(false);
    }
    expect(skipped.fieldValuesNotRecorded).toBe(true);
    expect(values.name).toBe("Old name");
    expect(restore().skipped.fieldValuesNotRecorded).toBe(false);
  });

  it("reports snapshot fields the template no longer has, when they held a value", () => {
    expect(restore().skipped.fields).toEqual(["Removed field"]);
  });
});
