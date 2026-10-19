import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  persist: vi.fn(),
  readiness: vi.fn(),
  listTemplates: vi.fn(),
  loadTemplate: vi.fn(),
  resolveTarget: vi.fn(),
  notify: vi.fn(),
  webhookActorId: vi.fn(),
  describeRule: vi.fn(),
  folderNote: vi.fn(),
}));
vi.mock("~/app/api/llm/generate-test-cases/core", () => ({
  generateTestCasesForProject: mocks.generate,
}));
vi.mock("~/lib/services/testCaseImport", () => ({
  persistGeneratedTestCases: mocks.persist,
}));
vi.mock("~/lib/services/jira-panel-generation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/services/jira-panel-generation")
  >()),
  getProjectReadiness: mocks.readiness,
  listProjectTemplates: mocks.listTemplates,
  loadTemplateData: mocks.loadTemplate,
  resolveImportTarget: mocks.resolveTarget,
}));
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: { createCasesDraftedNotification: mocks.notify },
}));
vi.mock("./actor", () => ({ webhookActorId: mocks.webhookActorId }));
vi.mock("./ruleSummary", () => ({
  describeDraftCasesRule: mocks.describeRule,
  draftFolderNote: mocks.folderNote,
}));

import { issueInProjectWhere } from "~/lib/issues/projectMembershipWhere";
import { runDraftCases, type DraftCasesJob } from "./draftCases";

const job: DraftCasesJob = {
  deliveryId: "del-1",
  webhookConfigId: "whc-1",
  webhookActionId: "draft-1",
  projectId: 7,
  issueId: 100,
  tenantId: "tenant-a",
};

const template = {
  template: {
    id: 4,
    name: "Functional",
    fields: [{ id: 1, name: "Steps", type: "steps", required: false }],
  },
  fieldMappings: [],
};

function makeDb(
  opts: {
    options?: Record<string, unknown>;
    enabled?: boolean;
    linked?: number;
    issue?: Record<string, unknown> | null;
    state?: { id: number; name: string } | null;
    folderDocs?: unknown;
  } = {}
) {
  return {
    webhookAction: {
      findUnique: vi.fn().mockResolvedValue({
        isEnabled: opts.enabled ?? true,
        trigger: "ISSUE_STATUS_ENTERED",
        filter: { statuses: ["Ready"], labels: ["qa"] },
        options: opts.options ?? {},
        webhookConfig: { name: null, adapterType: "JIRA" },
      }),
    },
    repositoryFolders: {
      findUnique: vi.fn().mockResolvedValue({ docs: opts.folderDocs ?? null }),
      update: vi.fn().mockResolvedValue({}),
    },
    issue: {
      findFirst: vi.fn().mockResolvedValue(
        opts.issue === undefined
          ? {
              id: 100,
              name: "DEMO-42",
              title: "Checkout totals",
              description: "Totals are wrong",
              status: "To Do",
              priority: "High",
              externalKey: "DEMO-42",
              projectId: 7,
              isDeleted: false,
            }
          : opts.issue
      ),
    },
    repositoryCaseIssue: {
      count: vi.fn().mockResolvedValue(opts.linked ?? 0),
    },
    projects: {
      findUnique: vi.fn().mockResolvedValue({ createdBy: "creator" }),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ name: "System" }) },
    workflows: { findFirst: vi.fn().mockResolvedValue(opts.state ?? null) },
    groupAssignment: {
      findMany: vi.fn().mockResolvedValue([{ userId: "g-member" }]),
    },
    webhookActionLog: { create: vi.fn().mockResolvedValue({}) },
    webhookDelivery: { update: vi.fn().mockResolvedValue({}) },
  };
}

const logged = (db: ReturnType<typeof makeDb>) =>
  db.webhookActionLog.create.mock.calls.map((c) => c[0].data);

describe("runDraftCases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.webhookActorId.mockResolvedValue("system-automation-user");
    mocks.readiness.mockResolvedValue({
      hasRepository: true,
      hasDefaultWorkflow: true,
      hasActiveLlm: true,
    });
    mocks.listTemplates.mockResolvedValue([
      { id: 3, name: "Other", isDefault: false },
      { id: 4, name: "Functional", isDefault: true },
    ]);
    mocks.loadTemplate.mockResolvedValue(template);
    mocks.describeRule.mockResolvedValue(
      "Issue status changes → Generate Test Cases with AI · Ready"
    );
    mocks.folderNote.mockResolvedValue({ type: "doc", content: [] });
    mocks.resolveTarget.mockResolvedValue({
      projectName: "Shop",
      repositoryId: 2,
      folderId: 55,
      folderName: "Issue status changes → Generate Test Cases with AI · Ready",
      stateId: 8,
      stateName: "Active",
      maxOrder: 3,
    });
    mocks.generate.mockResolvedValue({
      ok: true,
      testCases: [
        {
          id: "c1",
          name: "Totals add up",
          fieldValues: {
            Steps: [{ step: "Add two items", expectedResult: "Sum shown" }],
          },
        },
        { id: "c2", name: "Discount applies", fieldValues: {} },
      ],
      metadata: {},
    });
    mocks.persist.mockResolvedValue({
      status: "success",
      importedCount: 2,
      importedIds: [501, 502],
      errors: [],
      results: [],
    });
  });

  it("drafts the cases into the rule's folder and state, linked to the issue, and notifies users and group members", async () => {
    const db = makeDb({
      options: {
        stateId: 9,
        quantity: "couple",
        autoGenerateTags: false,
        notifyUserIds: ["u1"],
        notifyGroupIds: [3],
      },
      state: { id: 9, name: "Review" },
    });

    expect(await runDraftCases(db, job)).toEqual({
      outcome: "cases_drafted",
      caseCount: 2,
      folderId: 55,
    });

    // The folder is the rule's, named after it, and noted on first use.
    expect(mocks.describeRule).toHaveBeenCalledWith({
      trigger: "ISSUE_STATUS_ENTERED",
      statuses: ["Ready"],
    });
    expect(mocks.resolveTarget).toHaveBeenCalledWith(
      7,
      "system-automation-user",
      {
        newFolderName:
          "Issue status changes → Generate Test Cases with AI · Ready",
      },
      expect.anything()
    );
    expect(mocks.folderNote).toHaveBeenCalledWith({
      webhook: { name: null, adapterType: "JIRA" },
      ruleLine: "Issue status changes → Generate Test Cases with AI · Ready",
      filter: { statuses: ["Ready"], labels: ["qa"] },
      templateName: "Functional",
      stateName: "Review",
    });
    expect(db.repositoryFolders.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { docs: { type: "doc", content: [] } },
    });
    // The default template, since the rule names none.
    expect(mocks.loadTemplate).toHaveBeenCalledWith(4, expect.anything());
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 7,
        issue: {
          key: "DEMO-42",
          title: "Checkout totals",
          description: "Totals are wrong",
          status: "To Do",
          priority: "High",
        },
        context: { folderContext: 55 },
        quantity: "couple",
        autoGenerateTags: false,
        userId: "system-automation-user",
      })
    );
    const [input, author] = mocks.persist.mock.calls[0];
    expect(input).toMatchObject({
      projectId: 7,
      folderId: 55,
      templateId: 4,
      stateId: 9,
      stateName: "Review",
      linkIssueId: 100,
      autoGenerateTags: false,
    });
    // The steps field becomes the case's steps.
    expect(input.testCases[0].steps).toEqual([
      { step: "Add two items", expectedResult: "Sum shown" },
    ]);
    expect(author).toEqual({
      userId: "system-automation-user",
      userName: "System",
    });

    expect(logged(db)).toEqual([
      expect.objectContaining({
        webhookActionId: "draft-1",
        outcome: "cases_drafted",
        caseCount: 2,
        folderId: 55,
        issueId: 100,
      }),
    ]);
    expect(mocks.notify.mock.calls.map((c) => c[0].userId).sort()).toEqual([
      "g-member",
      "u1",
    ]);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 7,
        folderId: 55,
        folderName:
          "Issue status changes → Generate Test Cases with AI · Ready",
        issueKey: "DEMO-42",
        caseCount: 2,
        tenantId: "tenant-a",
      })
    );
  });

  it("generates tags unless the rule switched them off", async () => {
    await runDraftCases(makeDb(), job);
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({ autoGenerateTags: true })
    );
    expect(mocks.persist.mock.calls[0][0]).toMatchObject({
      autoGenerateTags: true,
    });
  });

  it("leaves a folder note that is already written alone", async () => {
    const db = makeDb({
      folderDocs: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await runDraftCases(db, job);
    expect(mocks.folderNote).not.toHaveBeenCalled();
    expect(db.repositoryFolders.update).not.toHaveBeenCalled();
  });

  it("keeps the target's default state when the rule's state isn't the project's", async () => {
    const db = makeDb({ options: { stateId: 99 }, state: null });
    await runDraftCases(db, job);
    expect(mocks.persist.mock.calls[0][0]).toMatchObject({
      stateId: 8,
      stateName: "Active",
    });
  });

  it("leaves an issue that already has test cases alone, not counting deleted ones", async () => {
    const db = makeDb({ linked: 1 });
    expect(await runDraftCases(db, job)).toEqual({ outcome: "has_cases" });
    expect(db.repositoryCaseIssue.count).toHaveBeenCalledWith({
      where: { issueId: 100, case: { isDeleted: false } },
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(logged(db)[0]).toMatchObject({ outcome: "has_cases" });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "ignored:has_cases" },
    });
  });

  it("records a project without an AI model", async () => {
    mocks.readiness.mockResolvedValue({
      hasRepository: true,
      hasDefaultWorkflow: true,
      hasActiveLlm: false,
    });
    const db = makeDb();
    expect(await runDraftCases(db, job)).toEqual({ outcome: "no_llm" });
    expect(logged(db)[0]).toMatchObject({ outcome: "no_llm" });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "ignored:no_llm" },
    });
  });

  it("records a failed generation with the model's reason", async () => {
    mocks.generate.mockResolvedValue({
      ok: false,
      status: 502,
      body: { error: "Provider timed out" },
    });
    const db = makeDb();
    expect(await runDraftCases(db, job)).toEqual({
      outcome: "draft_failed",
      detail: "Provider timed out",
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(logged(db)[0]).toMatchObject({
      outcome: "draft_failed",
      detail: "Provider timed out",
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "draft:Provider timed out" },
    });
  });

  it("does nothing for a rule that was turned off or deleted, or an issue that is gone", async () => {
    expect(await runDraftCases(makeDb({ enabled: false }), job)).toEqual({
      outcome: "rule_gone",
    });
    expect(await runDraftCases(makeDb({ issue: null }), job)).toEqual({
      outcome: "issue_gone",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("finds the issue through this project's visibility, not its home project", async () => {
    const db = makeDb();
    await runDraftCases(db, job);
    expect(db.issue.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: job.issueId, ...issueInProjectWhere(job.projectId) },
      })
    );
  });
});
