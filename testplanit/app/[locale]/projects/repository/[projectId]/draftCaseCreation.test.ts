import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { buildCaseDraftPayload } from "~/lib/services/caseDraft";
import {
  checkDraft,
  draftToBulkCreateCase,
  groupByTemplate,
  richTextToPlain,
  type DraftTemplate,
} from "./draftCaseCreation";

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

const field = (
  id: number,
  displayName: string,
  type: string,
  isRequired = false
) => ({
  caseFieldId: id,
  caseField: { id, displayName, isRequired, type: { type } },
});

const template: DraftTemplate = {
  id: 55,
  caseFields: [
    field(10, "Priority", "Dropdown", true),
    field(11, "Components", "Multi-Select"),
    field(12, "Weight", "Integer"),
    field(13, "Smoke", "Checkbox"),
    field(14, "Due", "Date", true),
    field(16, "Description", "Text Long"),
    field(17, "Steps", "Steps"),
  ],
};

const workflows = [
  { id: 100, name: "Draft" },
  { id: 101, name: "Ready" },
];

/** Stands in for the Add Case schema, with the same keys and messages. */
const schemaFor = () =>
  z.object({
    name: z.string().min(2, { error: "common.errors.caseNameRequired" }),
    templateId: z.number(),
    workflowId: z.number(),
    "10": z.number({ error: "Please select" }),
  });

const ctx = { templates: [template], workflows, schemaFor, t };

const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Pre" }] }],
};
const step = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Open" }] }],
});

function payloadWith(values: Record<string, unknown>, extras = {}) {
  return buildCaseDraftPayload(
    {
      name: "Login works",
      templateId: 55,
      workflowId: 101,
      estimate: "1h 30m",
      automated: true,
      "10": 3,
      "11": [4, 5],
      "12": "5",
      "13": false,
      "14": new Date("2026-10-16T12:00:00.000Z"),
      "16": JSON.stringify(doc),
      "17": [{ step, expectedResult: step, sharedStepGroupId: 9 }],
      ...values,
    },
    { tags: [7, 8], issues: [3], ...extras }
  );
}

describe("checkDraft", () => {
  it("passes a complete draft", () => {
    const check = checkDraft(
      { payload: payloadWith({}), folderMissing: false },
      ctx
    );
    expect(check.problems).toEqual([]);
    expect(check.template?.id).toBe(55);
    expect(check.values["14"]).toBeInstanceOf(Date);
  });

  it("flags a deleted folder, a missing template, and a missing state", () => {
    expect(
      checkDraft({ payload: payloadWith({}), folderMissing: true }, ctx)
        .problems
    ).toEqual(["repository.savedDrafts.problemFolder"]);
    const noTemplate = checkDraft(
      { payload: payloadWith({ templateId: 99 }), folderMissing: false },
      ctx
    );
    expect(noTemplate.template).toBeNull();
    expect(noTemplate.problems).toEqual([
      "repository.savedDrafts.problemTemplate",
    ]);
    expect(
      checkDraft(
        { payload: payloadWith({ workflowId: 999 }), folderMissing: false },
        ctx
      ).problems
    ).toEqual(["repository.savedDrafts.problemState"]);
  });

  it("reports the form schema's messages with the field's label", () => {
    const check = checkDraft(
      {
        payload: payloadWith({ name: "", "10": undefined }),
        folderMissing: false,
      },
      ctx
    );
    expect(check.problems).toHaveLength(2);
    expect(check.problems).toEqual(
      expect.arrayContaining([
        'repository.savedDrafts.problemField {"field":"repository.addCase.name","message":"common.errors.caseNameRequired"}',
        'repository.savedDrafts.problemField {"field":"Priority","message":"Please select"}',
      ])
    );
  });

  it("requires a required date the way the form does", () => {
    const check = checkDraft(
      { payload: payloadWith({ "14": undefined }), folderMissing: false },
      ctx
    );
    expect(check.problems).toEqual([
      'repository.savedDrafts.problemField {"field":"Due","message":"common.errors.fieldRequired"}',
    ]);
  });
});

describe("draftToBulkCreateCase", () => {
  it("maps the form's values to the bulk-create case shape", () => {
    const payload = payloadWith({ name: "  Login works " });
    const check = checkDraft({ payload, folderMissing: false }, ctx);
    expect(check.template).not.toBeNull();
    const out = draftToBulkCreateCase(
      { ...check, template: check.template! },
      { folderId: 42, payload },
      workflows
    );
    expect(out).toEqual({
      name: "Login works",
      folderId: 42,
      stateName: "Ready",
      automated: true,
      estimate: 5400,
      tags: [7, 8],
      issueIds: [3],
      steps: [
        { text: step, expectedResult: step, order: 0, sharedStepGroupId: 9 },
      ],
      customFields: {
        Priority: 3,
        Components: [4, 5],
        Weight: 5,
        Smoke: false,
        Due: "2026-10-16T12:00:00.000Z",
        Description: doc,
      },
    });
  });

  it("leaves empty optional parts out", () => {
    const payload = buildCaseDraftPayload(
      { name: "Minimal", templateId: 55, workflowId: 100, "10": 2, "13": true },
      {}
    );
    const check = checkDraft({ payload, folderMissing: false }, ctx);
    const out = draftToBulkCreateCase(
      { ...check, template: check.template! },
      { folderId: 42, payload },
      workflows
    );
    expect(out).toEqual({
      name: "Minimal",
      folderId: 42,
      stateName: "Draft",
      automated: false,
      customFields: { Priority: 2, Smoke: true },
    });
  });
});

describe("helpers", () => {
  it("groups items by template, keeping order within a group", () => {
    const groups = groupByTemplate([
      { id: "a", templateId: 1 },
      { id: "b", templateId: 2 },
      { id: "c", templateId: 1 },
    ]);
    expect([...groups.keys()]).toEqual([1, 2]);
    expect(groups.get(1)?.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("turns rich text into plain text", () => {
    expect(richTextToPlain(JSON.stringify(doc))).toBe("Pre");
    expect(richTextToPlain("plain")).toBe("plain");
  });
});
