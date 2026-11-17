import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserWithRole: vi.fn(),
  getAuthDb: vi.fn(),
  upsertLinkedIssueShell: vi.fn(),
  baseDb: { marker: "baseDb" },
}));

vi.mock("~/lib/auth/utils", () => ({
  getUserWithRole: mocks.getUserWithRole,
}));
vi.mock("~/lib/zenstack", () => ({ getAuthDb: mocks.getAuthDb }));
vi.mock("~/lib/db", () => ({ baseDb: mocks.baseDb }));
vi.mock("~/lib/services/linkedIssueUpsert", () => ({
  upsertLinkedIssueShell: mocks.upsertLinkedIssueShell,
}));

import { isCaseDraftPayload } from "./caseDraft";
import { stageGeneratedTestCasesForUser } from "./generatedCaseStaging";

function makeDb() {
  return {
    repositoryFolders: {
      findFirst: vi.fn(async () => ({ id: 2 })),
    },
    templates: {
      findFirst: vi.fn(async () => ({
        id: 7,
        caseFields: [
          {
            caseFieldId: 1,
            caseField: {
              id: 1,
              displayName: "Description",
              isRequired: true,
              isChecked: null,
              defaultValue: null,
              type: { type: "Text Long" },
              fieldOptions: [],
            },
          },
          {
            caseFieldId: 8,
            caseField: {
              id: 8,
              displayName: "Steps",
              isRequired: false,
              isChecked: null,
              defaultValue: null,
              type: { type: "Steps" },
              fieldOptions: [],
            },
          },
        ],
      })),
    },
    workflows: { findFirst: vi.fn(async () => ({ id: 3 })) },
    tags: {
      upsert: vi.fn(async ({ where }: { where: { name: string } }) => ({
        id: where.name === "smoke" ? 50 : 51,
      })),
    },
    issue: { findFirst: vi.fn(async (_args: unknown) => ({ id: 90 })) },
    caseDraft: { create: vi.fn(async (_args: { data: any }) => ({})) },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 1,
    folderId: 2,
    templateId: 7,
    stateId: 3,
    autoGenerateTags: true,
    testCases: [
      {
        id: "a",
        name: "Login works",
        fieldValues: { Description: "Signs in" },
        steps: [{ step: "Open", expectedResult: "Opened" }],
        tags: ["smoke", "login"],
      },
      {
        id: "b",
        name: "Login fails",
        fieldValues: {},
        tags: ["smoke"],
      },
    ],
    fieldMappings: [
      { fieldName: "Description", caseFieldId: 1, fieldType: "Text Long" },
    ],
    ...overrides,
  };
}

describe("stageGeneratedTestCasesForUser", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    mocks.getUserWithRole.mockResolvedValue({ id: "u1", access: "USER" });
    mocks.getAuthDb.mockResolvedValue(db);
    mocks.upsertLinkedIssueShell.mockResolvedValue({ id: 77 });
  });

  it("rejects an input that fails the schema before touching the database", async () => {
    const result = await stageGeneratedTestCasesForUser(
      input({ testCases: "nope" }) as never,
      "u1"
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe("Invalid input data");
    expect(result.errors[0]).toContain("testCases");
    expect(mocks.getUserWithRole).not.toHaveBeenCalled();
  });

  it("fails when the folder is not readable in the project", async () => {
    db.repositoryFolders.findFirst.mockResolvedValueOnce(null as never);
    const result = await stageGeneratedTestCasesForUser(input(), "u1");
    expect(result).toMatchObject({
      status: "error",
      message: "Folder not found",
    });
    expect(db.caseDraft.create).not.toHaveBeenCalled();
  });

  it("stages one saved CaseDraft per case, in the author's name and folder", async () => {
    const result = await stageGeneratedTestCasesForUser(input(), "u1");

    expect(result.status).toBe("success");
    expect(result.stagedCount).toBe(2);
    expect(result.errors).toEqual([]);
    expect(db.caseDraft.create).toHaveBeenCalledTimes(2);

    const first = db.caseDraft.create.mock.calls[0][0].data;
    expect(first.isSaved).toBe(true);
    expect(first.draftKey).toBe(`saved:${first.id}`);
    expect(first.name).toBe("Login works");
    expect(first.rowCount).toBe(1);
    expect(first.project).toEqual({ connect: { id: 1 } });
    expect(first.user).toEqual({ connect: { id: "u1" } });
    expect(first.folder).toEqual({ connect: { id: 2 } });
    expect(isCaseDraftPayload(first.payload)).toBe(true);
    expect(first.payload.values).toMatchObject({
      name: "Login works",
      templateId: 7,
      workflowId: 3,
    });
    expect(JSON.stringify(first.payload.values["1"])).toContain("Signs in");
    expect(first.payload.values["8"]).toHaveLength(1);
    expect(first.problemCount).toBe(0);

    const second = db.caseDraft.create.mock.calls[1][0].data;
    // Required Description left empty.
    expect(second.problemCount).toBe(1);
    expect(result.stagedIds).toEqual([first.id, second.id]);
  });

  it("upserts each tag name once and records the ids per case", async () => {
    await stageGeneratedTestCasesForUser(input(), "u1");

    expect(db.tags.upsert).toHaveBeenCalledTimes(2);
    expect(db.tags.upsert.mock.calls.map((c) => c[0].where.name)).toEqual([
      "smoke",
      "login",
    ]);
    const [first, second] = db.caseDraft.create.mock.calls.map(
      (c) => c[0].data.payload.extras
    );
    expect(first.tags).toEqual([50, 51]);
    expect(second.tags).toEqual([50]);
  });

  it("leaves tags alone when auto tags are off", async () => {
    await stageGeneratedTestCasesForUser(
      input({ autoGenerateTags: false }),
      "u1"
    );
    expect(db.tags.upsert).not.toHaveBeenCalled();
    const extras = db.caseDraft.create.mock.calls[0][0].data.payload.extras;
    expect(extras.tags).toEqual([]);
  });

  it("links the external source issue through the reviewed shell writer", async () => {
    await stageGeneratedTestCasesForUser(
      input({
        issue: {
          externalId: "10001",
          integrationId: 4,
          issueKey: "PROJ-1",
          title: "Login",
          externalUrl: "https://jira.example.com/browse/PROJ-1",
        },
      }),
      "u1"
    );
    expect(mocks.upsertLinkedIssueShell).toHaveBeenCalledTimes(1);
    const [client, args] = mocks.upsertLinkedIssueShell.mock.calls[0];
    expect(client).toBe(mocks.baseDb);
    expect(args).toMatchObject({
      externalId: "10001",
      integrationId: 4,
      create: { projectId: 1, createdById: "u1", externalKey: "PROJ-1" },
    });
    const extras = db.caseDraft.create.mock.calls[0][0].data.payload.extras;
    expect(extras.issues).toEqual([77]);
  });

  it("links an internal issue only when it is reachable from the project", async () => {
    await stageGeneratedTestCasesForUser(input({ linkIssueId: 90 }), "u1");
    expect(db.issue.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 90, isDeleted: false }),
      })
    );
    let extras = db.caseDraft.create.mock.calls[0][0].data.payload.extras;
    expect(extras.issues).toEqual([90]);

    vi.clearAllMocks();
    db = makeDb();
    mocks.getUserWithRole.mockResolvedValue({ id: "u1", access: "USER" });
    mocks.getAuthDb.mockResolvedValue(db);
    db.issue.findFirst.mockResolvedValueOnce(null as never);
    await stageGeneratedTestCasesForUser(input({ linkIssueId: 90 }), "u1");
    extras = db.caseDraft.create.mock.calls[0][0].data.payload.extras;
    expect(extras.issues).toEqual([]);
    expect(mocks.upsertLinkedIssueShell).not.toHaveBeenCalled();
  });

  it("keeps staging the other cases when one write fails", async () => {
    db.caseDraft.create
      .mockRejectedValueOnce(new Error("denied by policy"))
      .mockResolvedValueOnce({} as never);
    const result = await stageGeneratedTestCasesForUser(input(), "u1");
    expect(result.status).toBe("success");
    expect(result.stagedCount).toBe(1);
    expect(result.errors).toEqual([
      'Failed to stage "Login works": denied by policy',
    ]);
  });

  it("reports an error when nothing could be staged", async () => {
    db.caseDraft.create.mockRejectedValue(new Error("denied by policy"));
    const result = await stageGeneratedTestCasesForUser(input(), "u1");
    expect(result.status).toBe("error");
    expect(result.message).toBe("No test cases were staged");
    expect(result.errors).toHaveLength(2);
  });
});
