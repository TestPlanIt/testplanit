import { describe, expect, it } from "vitest";
import { emptyEditorContent } from "~/app/constants/backend";
import { isCaseDraftPayload, reviveCaseDraftValues } from "./caseDraft";
import {
  buildStagedCaseDraft,
  buildStagedCaseValues,
  countStagedCaseProblems,
  StageInputSchema,
  uniqueTagNames,
  type StagedCaseContext,
  type StagedFieldMapping,
  type StagingTemplateField,
} from "./stagedCaseFromGenerated";

const field = (
  id: number,
  displayName: string,
  type: string,
  extra: Partial<StagingTemplateField["caseField"]> = {}
): StagingTemplateField => ({
  caseFieldId: id,
  caseField: {
    id,
    displayName,
    isRequired: false,
    type: { type },
    ...extra,
  },
});

const fields: StagingTemplateField[] = [
  field(1, "Description", "Text Long", { isRequired: true }),
  field(2, "Priority", "Dropdown", {
    fieldOptions: [
      { fieldOption: { id: 10, name: "Low", isDefault: true } },
      { fieldOption: { id: 11, name: "High", isDefault: false } },
    ],
  }),
  field(3, "Components", "Multi-Select", {
    fieldOptions: [
      { fieldOption: { id: 20, name: "API" } },
      { fieldOption: { id: 21, name: "UI" } },
    ],
  }),
  field(4, "Weight", "Integer"),
  field(5, "Due", "Date", { isRequired: true }),
  field(6, "Automated?", "Checkbox", { isChecked: false }),
  field(7, "Spec", "Link"),
  field(8, "Steps", "Steps", { isRequired: true }),
];

const mappingFor = (
  f: StagingTemplateField,
  extra: Partial<StagedFieldMapping> = {}
): StagedFieldMapping => ({
  fieldName: f.caseField.displayName,
  caseFieldId: f.caseFieldId,
  fieldType: f.caseField.type.type,
  fieldOptions: f.caseField.fieldOptions?.map((o) => ({
    id: o.fieldOption.id,
    name: o.fieldOption.name,
  })),
  ...extra,
});

const ctx = (
  overrides: Partial<StagedCaseContext> = {}
): StagedCaseContext => ({
  templateId: 7,
  workflowId: 3,
  fields,
  fieldMappings: fields
    .filter((f) => f.caseField.type.type !== "Steps")
    .map((f) => mappingFor(f)),
  tagIds: [],
  issueIds: [],
  ...overrides,
});

describe("buildStagedCaseValues", () => {
  it("starts from the Add Case form's base values and the template defaults", () => {
    const values = buildStagedCaseValues(
      { id: "a", name: "  Login works  ", fieldValues: {} },
      ctx()
    );
    expect(values).toMatchObject({
      name: "Login works",
      templateId: 7,
      workflowId: 3,
      estimate: "",
      automated: false,
      "2": 10,
      "3": [],
      "4": "",
      "6": false,
      "7": "",
      "8": [],
    });
    expect(values["1"]).toBe(JSON.stringify(emptyEditorContent));
    expect(values["5"]).toBeUndefined();
  });

  it("writes each generated value in the type the form's schema expects", () => {
    const values = buildStagedCaseValues(
      {
        id: "a",
        name: "Case",
        fieldValues: {
          Description: "Plain text description",
          Priority: "high",
          Components: ["UI", "api"],
          Weight: "3",
          Due: "2026-11-03",
          "Automated?": "true",
          Spec: "https://example.com/spec",
        },
      },
      ctx()
    );
    const description = JSON.parse(values["1"] as string);
    expect(description.type).toBe("doc");
    expect(JSON.stringify(description)).toContain("Plain text description");
    expect(values["2"]).toBe(11);
    expect(values["3"]).toEqual([21, 20]);
    expect(values["4"]).toBe(3);
    expect(values["5"]).toBeInstanceOf(Date);
    expect((values["5"] as Date).toISOString()).toBe(
      "2026-11-03T12:00:00.000Z"
    );
    expect(values["6"]).toBe(true);
    expect(values["7"]).toBe("https://example.com/spec");
  });

  it("drops a value for an unmapped field, an unknown option, or an unparseable number", () => {
    const values = buildStagedCaseValues(
      {
        id: "a",
        name: "Case",
        fieldValues: {
          Priority: "Urgent",
          Weight: "heavy",
          Spec: "not a url",
          Unknown: "whatever",
        },
      },
      ctx({
        // Spec deselected: no mapping for it.
        fieldMappings: fields
          .filter(
            (f) =>
              f.caseField.type.type !== "Steps" &&
              f.caseField.displayName !== "Spec"
          )
          .map((f) => mappingFor(f)),
      })
    );
    expect(values["2"]).toBe(10);
    expect(values["4"]).toBe("");
    expect(values["7"]).toBe("");
    expect(values).not.toHaveProperty("Unknown");
  });

  it("stores the generated steps as the form's step rows, as TipTap documents", () => {
    const values = buildStagedCaseValues(
      {
        id: "a",
        name: "Case",
        fieldValues: {},
        steps: [
          { step: "Open the page", expectedResult: "Page loads" },
          {
            step: { type: "doc", content: [] },
            expectedResult: "",
          },
        ],
      },
      ctx()
    );
    const rows = values["8"] as {
      id: string;
      step: { type: string };
      expectedResult: { type: string };
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].step.type).toBe("doc");
    expect(JSON.stringify(rows[0].step)).toContain("Open the page");
    expect(JSON.stringify(rows[0].expectedResult)).toContain("Page loads");
    expect(rows[1].step).toEqual({ type: "doc", content: [] });
    expect(rows[1].expectedResult).toEqual(emptyEditorContent);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("ignores a Steps value that arrives through fieldValues", () => {
    const values = buildStagedCaseValues(
      {
        id: "a",
        name: "Case",
        fieldValues: { Steps: [{ step: "x", expectedResult: "y" }] },
      },
      ctx({
        fieldMappings: fields.map((f) => mappingFor(f)),
      })
    );
    expect(values["8"]).toEqual([]);
  });
});

describe("countStagedCaseProblems", () => {
  it("counts a short name and each required field left empty", () => {
    const values = buildStagedCaseValues(
      { id: "a", name: "X", fieldValues: {} },
      ctx()
    );
    // name, Description (empty doc), Due (no date), Steps (no rows)
    expect(countStagedCaseProblems(values, fields)).toBe(4);
  });

  it("is zero once every required field is filled", () => {
    const values = buildStagedCaseValues(
      {
        id: "a",
        name: "Login works",
        fieldValues: { Description: "Filled", Due: "2026-01-01" },
        steps: [{ step: "Do", expectedResult: "Done" }],
      },
      ctx()
    );
    expect(countStagedCaseProblems(values, fields)).toBe(0);
  });
});

describe("buildStagedCaseDraft", () => {
  it("produces a payload the Add Case form can restore, with tags and issues in extras", () => {
    const draft = buildStagedCaseDraft(
      {
        id: "a",
        name: "Login works",
        fieldValues: { Due: "2026-11-03" },
      },
      ctx({ tagIds: [5, 6], issueIds: [9] })
    );
    expect(draft.name).toBe("Login works");
    expect(isCaseDraftPayload(draft.payload)).toBe(true);
    expect(draft.payload.dateFields).toEqual(["5"]);
    expect(draft.payload.values["5"]).toBe("2026-11-03T12:00:00.000Z");
    expect(draft.payload.extras).toEqual({ tags: [5, 6], issues: [9] });
    const revived = reviveCaseDraftValues(draft.payload);
    expect(revived["5"]).toBeInstanceOf(Date);
  });
});

describe("uniqueTagNames", () => {
  it("trims, drops blanks, and de-duplicates across cases", () => {
    expect(
      uniqueTagNames([
        { tags: [" smoke ", "login", ""] },
        { tags: ["smoke"] },
        {},
      ])
    ).toEqual(["smoke", "login"]);
  });
});

describe("StageInputSchema", () => {
  it("accepts the wizard's payload after a wire round-trip", () => {
    const sent = JSON.parse(
      JSON.stringify({
        projectId: 1,
        folderId: 2,
        templateId: 7,
        stateId: 3,
        autoGenerateTags: true,
        testCases: [
          {
            id: "a",
            name: "Case",
            fieldValues: { Description: "d" },
            steps: [{ step: "s", expectedResult: undefined }],
            tags: ["smoke"],
          },
        ],
        fieldMappings: [
          {
            fieldName: "Description",
            caseFieldId: 1,
            fieldType: "Text Long",
            fieldOptions: undefined,
          },
        ],
        issue: undefined,
      })
    );
    expect(StageInputSchema.safeParse(sent).success).toBe(true);
  });
});
