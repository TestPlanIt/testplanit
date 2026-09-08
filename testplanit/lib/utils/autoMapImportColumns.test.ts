import { describe, expect, it } from "vitest";
import {
  autoMapImportColumns,
  type MappableField,
} from "./autoMapImportColumns";

const field = (
  id: string,
  displayName: string,
  overrides: Partial<MappableField> = {}
): MappableField => ({
  id,
  displayName,
  isRequired: false,
  type: "Text String",
  ...overrides,
});

const TEMPLATE_FIELDS: MappableField[] = [
  field("folder", "Folder"),
  field("name", "Name", { isRequired: true }),
  field("description", "Description", { type: "Text Long" }),
  field("preconditions", "Preconditions", { type: "Text Long" }),
  field("priority", "Priority", { type: "Dropdown" }),
  field("steps", "Steps", { type: "Steps" }),
  field("expectedResult", "Expected Result", { type: "ExpectedResult" }),
  field("issues", "Issues", { type: "Issues" }),
  field("tags", "Tags", { type: "Tags" }),
  field("id", "Case ID (TestPlanIt)", { type: "ID" }),
];

const mapOf = (headers: string[]) =>
  Object.fromEntries(
    autoMapImportColumns(headers, TEMPLATE_FIELDS).map((m) => [
      m.csvColumn,
      m.templateField,
    ])
  );

describe("autoMapImportColumns", () => {
  it("maps Case ID only from exact headers", () => {
    expect(mapOf(["ID"])["ID"]).toBe("id");
    expect(mapOf(["Case ID"])["Case ID"]).toBe("id");
    expect(mapOf(["Test Case ID"])["Test Case ID"]).toBe("id");
  });

  it("leaves external reference columns unmapped instead of claiming Case ID", () => {
    const mapped = mapOf([
      "Ticket ID",
      "Issue ID",
      "Jira ID",
      "External ID",
      "Bug ID",
    ]);

    expect(mapped["Ticket ID"]).toBeNull();
    expect(mapped["Jira ID"]).toBeNull();
    expect(mapped["External ID"]).toBeNull();
    expect(mapped["Bug ID"]).toBeNull();
    // "Issue ID" still reaches the Issues field through the "issue" alias,
    // which is where external references belong.
    expect(mapped["Issue ID"]).toBe("issues");
  });

  it("maps the columns of a ticket-exported file without touching Case ID", () => {
    const mapped = mapOf([
      "Folder",
      "Ticket ID",
      "Title",
      "Priority",
      "Preconditions",
      "Test Steps",
      "Expected Result",
    ]);

    expect(mapped).toEqual({
      Folder: "folder",
      "Ticket ID": null,
      Title: "name",
      Priority: "priority",
      Preconditions: "preconditions",
      "Test Steps": "steps",
      "Expected Result": "expectedResult",
    });
  });

  it("claims each field at most once", () => {
    const mapped = autoMapImportColumns(["ID", "Case ID"], TEMPLATE_FIELDS);

    expect(mapped[0].templateField).toBe("id");
    expect(mapped[1].templateField).toBeNull();
  });

  it("ignores the template column", () => {
    expect(mapOf(["Template Name"])["Template Name"]).toBeNull();
  });

  it("falls back to alias and partial matching for non-ID columns", () => {
    const mapped = mapOf(["Case Name", "Tag", "Expected Outcome"]);

    expect(mapped["Case Name"]).toBe("name");
    expect(mapped["Tag"]).toBe("tags");
    expect(mapped["Expected Outcome"]).toBe("expectedResult");
  });
});
