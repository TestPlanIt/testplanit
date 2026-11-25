import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: null as any,
  review: vi.fn(),
  rewrite: vi.fn(),
  loadTemplate: vi.fn(),
  resolveTarget: vi.fn(),
  persist: vi.fn(),
  notify: vi.fn(),
  recipients: vi.fn(),
  actor: vi.fn(),
  aiDraftState: vi.fn(),
  markAiWritten: vi.fn(),
}));

vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mocks.tx),
}));
vi.mock("~/lib/issues/projectMembershipWhere", () => ({
  issueInProjectWhere: (projectId: number) => ({ inProject: projectId }),
}));
vi.mock("~/lib/services/caseUpkeep/review", () => ({
  reviewCasesAgainstIssue: mocks.review,
}));
vi.mock("~/lib/services/caseUpkeep/rewrite", () => ({
  rewriteCase: mocks.rewrite,
}));
vi.mock("~/lib/services/caseUpkeep/recipients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/lib/services/caseUpkeep/recipients")
  >()),
  upkeepRecipients: mocks.recipients,
}));
vi.mock("~/lib/services/jira-panel-generation", () => ({
  loadTemplateData: mocks.loadTemplate,
  resolveImportTarget: mocks.resolveTarget,
  toImportCases: (_template: unknown, cases: unknown) => cases,
}));
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: { createCasesUpdatedNotification: mocks.notify },
}));
vi.mock("~/lib/services/testCaseImport", () => ({
  persistGeneratedTestCases: mocks.persist,
}));
vi.mock("./actor", () => ({ webhookActorId: mocks.actor }));
vi.mock("./aiDrafts", () => ({
  aiDraftState: mocks.aiDraftState,
  markAiWritten: mocks.markAiWritten,
}));

import {
  previousIssueText,
  reportUpdateCasesFailure,
  runUpdateCases,
  type UpdateCasesJob,
} from "./updateCases";

const job: UpdateCasesJob = {
  deliveryId: "del-1",
  webhookConfigId: "cfg-1",
  webhookActionId: "rule-1",
  projectId: 7,
  issueId: 100,
  tenantId: "t1",
};

const CHANGED = new Date("2026-11-24T10:00:00Z");
const BEFORE = new Date("2026-11-20T10:00:00Z");
const AFTER = new Date("2026-11-24T11:00:00Z");

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

interface LinkOpts {
  alignedAt?: Date | null;
  templateId?: number;
  folderId?: number;
  currentVersion?: number;
  reviewedById?: string | null;
}
const link = (id: number, opts: LinkOpts = {}) => ({
  alignedAt: opts.alignedAt === undefined ? BEFORE : opts.alignedAt,
  case: {
    id,
    name: `Case ${id}`,
    templateId: opts.templateId ?? 4,
    folderId: opts.folderId ?? 55,
    currentVersion: opts.currentVersion ?? 1,
    reviewedById: opts.reviewedById ?? null,
    caseFieldValues: [],
    steps: [
      {
        step: doc("Do it"),
        expectedResult: doc("Done"),
        sharedStepGroupId: null,
      },
    ],
  },
});

/** How each case looks when the transaction re-reads it. */
type Fresh = {
  currentVersion: number;
  aiWrittenVersion: number | null;
  state: { isAiDraft: boolean } | null;
} | null;
const aiDraft: Fresh = {
  currentVersion: 1,
  aiWrittenVersion: 1,
  state: { isAiDraft: true },
};
const reviewed: Fresh = {
  currentVersion: 1,
  aiWrittenVersion: 1,
  state: { isAiDraft: false },
};

function makeDb(
  opts: {
    rule?: { isEnabled: boolean; options: unknown } | null;
    issue?: Record<string, unknown> | null;
    links?: ReturnType<typeof link>[];
    otherLinks?: unknown[];
    versions?: unknown[];
    state?: { id: number; name: string } | null;
    approvals?: unknown[];
  } = {}
) {
  return {
    webhookAction: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.rule === undefined ? { isEnabled: true, options: {} } : opts.rule
        ),
    },
    issue: {
      findFirst: vi.fn().mockResolvedValue(
        opts.issue === undefined
          ? {
              id: 100,
              name: "DEMO-42",
              title: "Checkout totals",
              description: "Add tax",
              externalKey: "DEMO-42",
              isDeleted: false,
              isRequirement: false,
              contentUpdatedAt: CHANGED,
            }
          : opts.issue
      ),
    },
    repositoryCaseIssue: {
      findMany: vi.fn(async (args: any) =>
        args.where.issueId?.not !== undefined
          ? (opts.otherLinks ?? [])
          : (opts.links ?? [link(12)])
      ),
    },
    issueVersions: { findMany: vi.fn().mockResolvedValue(opts.versions ?? []) },
    projects: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ name: "Shop", createdBy: "creator" }),
    },
    workflows: { findFirst: vi.fn().mockResolvedValue(opts.state ?? null) },
    user: { findUnique: vi.fn().mockResolvedValue({ name: "System" }) },
    reviewRequest: {
      findMany: vi.fn().mockResolvedValue(opts.approvals ?? []),
    },
    webhookActionLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function makeTx(fresh: Record<number, Fresh> = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    repositoryCases: {
      findFirst: vi.fn(async (args: any) =>
        args.where.id in fresh ? fresh[args.where.id] : aiDraft
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    repositoryCaseIssue: { updateMany: vi.fn().mockResolvedValue({}) },
    caseChangeSuggestion: {
      updateMany: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

const logged = (db: ReturnType<typeof makeDb>) =>
  db.webhookActionLog.create.mock.calls.map((c) => c[0].data);

const template = (id = 4) => ({
  template: {
    id,
    name: `Template ${id}`,
    fields: [
      { id: 1, name: "Priority", type: "Dropdown", required: true },
      { id: 2, name: "Steps", type: "Steps", required: false },
    ],
  },
  fieldMappings: [
    { fieldName: "Priority", caseFieldId: 1, fieldType: "Dropdown" },
  ],
});

const proposed = {
  name: "Case 12 with tax",
  fieldValues: {},
  steps: [{ step: "Do it", expectedResult: "Done with tax" }],
};
const answer = (
  decisions: unknown[],
  newCases: unknown[] = [],
  problems: string[] = []
) => ({
  ok: true,
  decisions,
  newCases,
  problems,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx = makeTx();
  mocks.actor.mockResolvedValue("system-automation-user");
  mocks.loadTemplate.mockImplementation(async (id: number) => template(id));
  mocks.review.mockResolvedValue(answer([{ caseId: 12, action: "unchanged" }]));
  mocks.rewrite.mockResolvedValue({ ok: true, version: 2, skippedFields: [] });
  mocks.recipients.mockResolvedValue(["u1"]);
  mocks.aiDraftState.mockResolvedValue(null);
  mocks.resolveTarget.mockResolvedValue({
    projectName: "Shop",
    repositoryId: 2,
    folderId: 55,
    folderName: "Drafts",
    stateId: 8,
    stateName: "Draft",
    maxOrder: 3,
  });
  mocks.persist.mockResolvedValue({
    status: "success",
    importedCount: 1,
    importedIds: [900],
    errors: [],
    results: [],
  });
});

describe("previousIssueText", () => {
  const v = (title: string, at: string) => ({
    title,
    description: `${title} text`,
    changedAt: new Date(at),
  });
  const history = [
    v("one", "2026-11-01T00:00:00Z"),
    v("two", "2026-11-10T00:00:00Z"),
    v("three", "2026-11-20T00:00:00Z"),
  ];

  it("picks the newest version no later than the alignment", () => {
    expect(
      previousIssueText(history, new Date("2026-11-15T00:00:00Z"))
    ).toEqual({
      title: "two",
      description: "two text",
    });
  });

  it("picks the oldest version when none is that old, or nothing was ever aligned", () => {
    expect(
      previousIssueText(history, new Date("2026-10-01T00:00:00Z"))?.title
    ).toBe("one");
    expect(previousIssueText(history, null)?.title).toBe("one");
  });

  it("is null when that version is the current text, or there is no history", () => {
    expect(
      previousIssueText(history, new Date("2026-11-21T00:00:00Z"))
    ).toBeNull();
    expect(previousIssueText([history[0]], null)).toBeNull();
    expect(previousIssueText([], null)).toBeNull();
  });

  it("reads a missing description as empty", () => {
    expect(
      previousIssueText(
        [{ title: "one", description: null, changedAt: BEFORE }, history[2]],
        null
      )
    ).toEqual({ title: "one", description: "" });
  });
});

describe("reportUpdateCasesFailure", () => {
  const failureDb = (
    opts: { issue?: unknown; rule?: unknown; project?: unknown } = {}
  ) => ({
    webhookActionLog: { create: vi.fn().mockResolvedValue({}) },
    webhookAction: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.rule === undefined
            ? { options: { notifyUserIds: ["u1"] } }
            : opts.rule
        ),
    },
    issue: {
      findUnique: vi.fn().mockResolvedValue(
        opts.issue === undefined
          ? {
              name: "DEMO-42",
              externalKey: "DEMO-42",
              title: "Checkout totals",
            }
          : opts.issue
      ),
    },
    projects: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.project === undefined ? { name: "Shop" } : opts.project
        ),
    },
  });

  it("logs the failure and tells the rule's recipients", async () => {
    mocks.recipients.mockResolvedValue(["u1", "u2"]);
    const db = failureDb();
    await reportUpdateCasesFailure(db, job, "database is down");
    expect(db.webhookActionLog.create.mock.calls[0][0].data).toMatchObject({
      webhookActionId: "rule-1",
      webhookConfigId: "cfg-1",
      deliveryId: "del-1",
      projectId: 7,
      issueId: 100,
      outcome: "update_failed",
      detail: "database is down",
    });
    expect(mocks.recipients).toHaveBeenCalledWith(db, {
      projectId: 7,
      issueId: 100,
      options: { notifyUserIds: ["u1"] },
    });
    expect(mocks.notify.mock.calls.map((c) => c[0])).toEqual(
      ["u1", "u2"].map((userId) => ({
        userId,
        kind: "failed",
        projectId: 7,
        projectName: "Shop",
        issueId: 100,
        issueKey: "DEMO-42",
        issueTitle: "Checkout totals",
        detail: "database is down",
        tenantId: "t1",
      }))
    );
  });

  it("still logs, and tells nobody, when the issue is gone", async () => {
    const db = failureDb({ issue: null });
    await reportUpdateCasesFailure(db, job, "boom");
    expect(db.webhookActionLog.create).toHaveBeenCalled();
    expect(mocks.recipients).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("falls back cleanly when the rule or the project is gone", async () => {
    mocks.recipients.mockResolvedValue(["admin"]);
    const db = failureDb({
      rule: null,
      project: null,
      issue: { name: "Local 3", externalKey: null, title: "A bug" },
    });
    await reportUpdateCasesFailure(db, job, "boom");
    expect(mocks.recipients.mock.calls[0][1].options).toEqual({});
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({
      projectName: "",
      issueKey: "Local 3",
    });
  });
});

describe("runUpdateCases: nothing to do", () => {
  it("does nothing for a rule that is off or gone", async () => {
    for (const rule of [null, { isEnabled: false, options: {} }]) {
      const db = makeDb({ rule });
      expect(await runUpdateCases(db, job)).toEqual({ outcome: "rule_gone" });
      expect(db.issue.findFirst).not.toHaveBeenCalled();
      expect(logged(db)).toEqual([]);
    }
  });

  it("does nothing for an issue that is gone or deleted, found through this project", async () => {
    const gone = makeDb({ issue: null });
    expect(await runUpdateCases(gone, job)).toEqual({ outcome: "issue_gone" });
    expect(gone.issue.findFirst.mock.calls[0][0].where).toEqual({
      id: 100,
      inProject: 7,
    });
    const deleted = makeDb({ issue: { id: 100, isDeleted: true } });
    expect(await runUpdateCases(deleted, job)).toEqual({
      outcome: "issue_gone",
    });
  });

  it("records an issue with no linked cases", async () => {
    const db = makeDb({ links: [] });
    expect(await runUpdateCases(db, job)).toEqual({ outcome: "no_cases" });
    expect(logged(db)).toMatchObject([{ outcome: "no_cases", issueId: 100 }]);
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("reads live, unarchived, manual cases of this project, every one by default", async () => {
    const db = makeDb();
    await runUpdateCases(db, job);
    expect(db.repositoryCaseIssue.findMany.mock.calls[0][0].where).toEqual({
      issueId: 100,
      case: {
        projectId: 7,
        isDeleted: false,
        isArchived: false,
        automated: false,
      },
    });
  });

  it("reads only cases the AI drafted when the rule says so", async () => {
    const db = makeDb({
      rule: { isEnabled: true, options: { scope: "ai_drafted" } },
    });
    await runUpdateCases(db, job);
    expect(db.repositoryCaseIssue.findMany.mock.calls[0][0].where.case).toEqual(
      {
        projectId: 7,
        isDeleted: false,
        isArchived: false,
        automated: false,
        aiWrittenVersion: { not: null },
      }
    );
  });

  it("skips cases already aligned with the issue's current text", async () => {
    const db = makeDb({ links: [link(12, { alignedAt: AFTER })] });
    expect(await runUpdateCases(db, job)).toEqual({ outcome: "up_to_date" });
    expect(logged(db)).toMatchObject([{ outcome: "up_to_date", caseCount: 1 }]);
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("checks only the stale cases when some are aligned", async () => {
    const db = makeDb({
      links: [
        link(12, { alignedAt: AFTER }),
        link(13),
        link(14, { alignedAt: null }),
      ],
    });
    mocks.review.mockResolvedValue(
      answer([
        { caseId: 13, action: "unchanged" },
        { caseId: 14, action: "unchanged" },
      ])
    );
    await runUpdateCases(db, job);
    expect(mocks.review.mock.calls[0][1].cases.map((c: any) => c.id)).toEqual([
      13, 14,
    ]);
  });

  it("checks only never-aligned cases when the issue's text was never edited", async () => {
    const neverEdited = {
      id: 100,
      name: "DEMO-42",
      title: "T",
      description: null,
      externalKey: null,
      isDeleted: false,
      isRequirement: false,
      contentUpdatedAt: null,
    };
    // Aligned with an issue that has not changed since: nothing to check.
    const aligned = makeDb({
      issue: neverEdited,
      links: [link(12, { alignedAt: AFTER })],
    });
    expect(await runUpdateCases(aligned, job)).toEqual({
      outcome: "up_to_date",
    });
    expect(mocks.review).not.toHaveBeenCalled();

    const db = makeDb({
      issue: neverEdited,
      links: [link(12, { alignedAt: null }), link(13, { alignedAt: AFTER })],
    });
    await runUpdateCases(db, job);
    expect(mocks.review).toHaveBeenCalledTimes(1);
    expect(mocks.review.mock.calls[0][1].cases.map((c: any) => c.id)).toEqual([
      12,
    ]);
    expect(mocks.review.mock.calls[0][1].issue).toEqual({
      key: "DEMO-42",
      title: "T",
      description: "",
      previous: null,
    });
  });
});

describe("runUpdateCases: asking the model", () => {
  it("records a project without an AI model and tells nobody", async () => {
    mocks.review.mockResolvedValue({ ok: false, reason: "no_llm" });
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toEqual({ outcome: "no_llm" });
    expect(logged(db)).toMatchObject([{ outcome: "no_llm" }]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("records a failed check and tells the recipients why", async () => {
    mocks.review.mockResolvedValue({
      ok: false,
      reason: "failed",
      detail: "rate limited",
    });
    const db = makeDb({
      rule: { isEnabled: true, options: { notifyUserIds: ["u1"] } },
    });
    expect(await runUpdateCases(db, job)).toEqual({
      outcome: "update_failed",
      detail: "rate limited",
    });
    expect(logged(db)).toMatchObject([
      { outcome: "update_failed", detail: "rate limited" },
    ]);
    expect(mocks.recipients).toHaveBeenCalledWith(db, {
      projectId: 7,
      issueId: 100,
      options: { notifyUserIds: ["u1"] },
    });
    expect(mocks.notify).toHaveBeenCalledWith({
      userId: "u1",
      projectId: 7,
      projectName: "Shop",
      issueId: 100,
      issueKey: "DEMO-42",
      issueTitle: "Checkout totals",
      tenantId: "t1",
      kind: "failed",
      detail: "rate limited",
    });
    expect(mocks.tx.repositoryCases.findFirst).not.toHaveBeenCalled();
  });

  it("fails when no template can be read", async () => {
    mocks.loadTemplate.mockResolvedValue(null);
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toEqual({
      outcome: "update_failed",
      detail: "template 4 could not be read",
    });
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it("carries on with the templates it can read", async () => {
    mocks.loadTemplate.mockImplementation(async (id: number) =>
      id === 9 ? null : template(id)
    );
    const db = makeDb({ links: [link(12), link(13, { templateId: 9 })] });
    const result = await runUpdateCases(db, job);
    expect(result).toMatchObject({ outcome: "no_changes", checked: 1 });
    expect(logged(db)[0].detail).toContain("template 9 could not be read");
  });

  it("asks once per template, the most used template first, as the System user", async () => {
    const db = makeDb({
      links: [
        link(12, { templateId: 9 }),
        link(13, { templateId: 4 }),
        link(14, { templateId: 4 }),
      ],
    });
    mocks.review.mockImplementation(async (_db: unknown, params: any) =>
      answer(
        params.cases.map((c: any) => ({ caseId: c.id, action: "unchanged" }))
      )
    );
    await runUpdateCases(db, job);
    expect(mocks.review.mock.calls.map((c) => c[1].template.id)).toEqual([
      4, 9,
    ]);
    expect(mocks.review.mock.calls[0][1]).toMatchObject({
      projectId: 7,
      tenantId: "t1",
      userId: "system-automation-user",
    });
    expect(mocks.review.mock.calls[0][1].cases[0]).toMatchObject({
      id: 13,
      name: "Case 13",
      steps: [{ step: "Do it", expectedResult: "Done" }],
    });
  });

  it("passes the other issues the cases are linked to, once each", async () => {
    const db = makeDb({
      otherLinks: [
        {
          issue: { name: "DEMO-7", externalKey: "DEMO-7", title: "Tax rules" },
        },
        {
          issue: { name: "DEMO-7", externalKey: "DEMO-7", title: "Tax rules" },
        },
        { issue: { name: "Local 3", externalKey: null, title: "A bug" } },
      ],
    });
    await runUpdateCases(db, job);
    expect(mocks.review.mock.calls[0][1].otherIssues).toEqual([
      { key: "DEMO-7", title: "Tax rules" },
      { key: "Local 3", title: "A bug" },
    ]);
    expect(db.repositoryCaseIssue.findMany.mock.calls[1][0].where).toEqual({
      caseId: { in: [12] },
      issueId: { not: 100 },
      issue: { isDeleted: false },
    });
  });

  it("gives the earlier text of a requirement, from the oldest alignment", async () => {
    const requirement = {
      id: 100,
      name: "DEMO-42",
      title: "Checkout totals",
      description: "Add tax",
      externalKey: "DEMO-42",
      isDeleted: false,
      isRequirement: true,
      contentUpdatedAt: CHANGED,
    };
    const versions = [
      {
        title: "v1",
        description: "one",
        changedAt: new Date("2026-11-01T00:00:00Z"),
      },
      {
        title: "v2",
        description: "two",
        changedAt: new Date("2026-11-19T00:00:00Z"),
      },
      { title: "v3", description: "three", changedAt: CHANGED },
    ];
    const db = makeDb({
      issue: requirement,
      versions,
      links: [
        link(12),
        link(13, { alignedAt: new Date("2026-11-22T00:00:00Z") }),
      ],
    });
    mocks.review.mockResolvedValue(
      answer([
        { caseId: 12, action: "unchanged" },
        { caseId: 13, action: "unchanged" },
      ])
    );
    await runUpdateCases(db, job);
    expect(mocks.review.mock.calls[0][1].issue.previous).toEqual({
      title: "v2",
      description: "two",
    });

    // A link that was never aligned: the oldest text is the baseline.
    const never = makeDb({
      issue: requirement,
      versions,
      links: [link(12), link(13, { alignedAt: null })],
    });
    await runUpdateCases(never, job);
    expect(mocks.review.mock.calls[1][1].issue.previous?.title).toBe("v1");
  });

  it("does not read version history for an issue that is not a requirement", async () => {
    const db = makeDb();
    await runUpdateCases(db, job);
    expect(db.issueVersions.findMany).not.toHaveBeenCalled();
  });
});

describe("runUpdateCases: acting on the answer", () => {
  it("marks an unchanged case aligned, closes an old suggestion, and tells nobody", async () => {
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toEqual({
      outcome: "no_changes",
      checked: 1,
      rewritten: 0,
      added: 0,
      deleted: 0,
      suggested: 0,
    });
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.tx.caseChangeSuggestion.updateMany).toHaveBeenCalledWith({
      where: { caseId: 12, issueId: 100, status: "PENDING" },
      data: { status: "SUPERSEDED" },
    });
    expect(mocks.tx.repositoryCaseIssue.updateMany).toHaveBeenCalledWith({
      where: { caseId: 12, issueId: 100 },
      data: { alignedAt: expect.any(Date) },
    });
    expect(logged(db)).toMatchObject([
      {
        outcome: "no_changes",
        caseCount: 1,
        detail: "checked 1: 0 rewritten, 0 added, 0 deleted, 0 suggested",
      },
    ]);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.recipients).not.toHaveBeenCalled();
  });

  it("rewrites an untouched AI draft in place and records the AI as its writer", async () => {
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "update", reason: "Tax", proposed }])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({
      outcome: "cases_updated",
      rewritten: 1,
      suggested: 0,
    });
    expect(mocks.rewrite).toHaveBeenCalledWith(mocks.tx, {
      caseId: 12,
      expectedVersion: 1,
      proposed,
      fieldMappings: template().fieldMappings,
    });
    expect(mocks.tx.repositoryCases.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { aiWrittenVersion: 2 },
    });
    expect(mocks.tx.repositoryCaseIssue.updateMany).toHaveBeenCalled();
    expect(mocks.tx.caseChangeSuggestion.create).not.toHaveBeenCalled();
  });

  it("suggests the change for a case that has left the AI state", async () => {
    mocks.tx = makeTx({ 12: reviewed });
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "update", reason: "Tax", proposed }])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({
      outcome: "cases_updated",
      rewritten: 0,
      suggested: 1,
    });
    expect(mocks.rewrite).not.toHaveBeenCalled();
    expect(mocks.tx.caseChangeSuggestion.create).toHaveBeenCalledWith({
      data: {
        projectId: 7,
        caseId: 12,
        issueId: 100,
        issueContentUpdatedAt: CHANGED,
        baseCaseVersion: 1,
        kind: "UPDATE",
        proposed: {
          templateId: 4,
          base: {
            name: "Case 12",
            fieldValues: {},
            steps: [{ step: "Do it", expectedResult: "Done" }],
          },
          ...proposed,
        },
        rationale: "Tax",
        webhookActionId: "rule-1",
        deliveryId: "del-1",
      },
    });
    // Not aligned: the case still reads as behind the issue until decided.
    expect(mocks.tx.repositoryCaseIssue.updateMany).not.toHaveBeenCalled();
  });

  it("suggests, not rewrites, for a draft someone has saved since the AI wrote it", async () => {
    mocks.tx = makeTx({
      12: {
        currentVersion: 1,
        aiWrittenVersion: null,
        state: { isAiDraft: true },
      },
    });
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "update", reason: "", proposed }])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({ suggested: 1 });
    expect(mocks.rewrite).not.toHaveBeenCalled();
    expect(
      mocks.tx.caseChangeSuggestion.create.mock.calls[0][0].data.rationale
    ).toBeNull();
  });

  it("deletes an untouched AI draft the issue no longer asks for", async () => {
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "retire", reason: "Dropped" }])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({
      outcome: "cases_updated",
      deleted: 1,
    });
    expect(mocks.tx.repositoryCases.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { isDeleted: true },
    });
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({
      kind: "summary",
      deleted: 1,
      deletedNames: ["Case 12"],
    });
  });

  it("suggests retiring a reviewed case, with no proposed text", async () => {
    mocks.tx = makeTx({ 12: reviewed });
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "retire", reason: "Dropped" }])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({
      suggested: 1,
      deleted: 0,
    });
    const data = mocks.tx.caseChangeSuggestion.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "RETIRE", rationale: "Dropped" });
    expect(data).not.toHaveProperty("proposed");
    expect(mocks.tx.repositoryCases.update).not.toHaveBeenCalled();
  });

  it("leaves alone a case that was saved or deleted while the model read it", async () => {
    mocks.tx = makeTx({
      12: {
        currentVersion: 2,
        aiWrittenVersion: 1,
        state: { isAiDraft: true },
      },
      13: null,
    });
    mocks.review.mockResolvedValue(
      answer([
        { caseId: 12, action: "update", reason: "Tax", proposed },
        { caseId: 13, action: "retire", reason: "Dropped" },
      ])
    );
    const db = makeDb({ links: [link(12), link(13)] });
    expect(await runUpdateCases(db, job)).toMatchObject({
      outcome: "no_changes",
    });
    expect(mocks.rewrite).not.toHaveBeenCalled();
    expect(mocks.tx.caseChangeSuggestion.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.caseChangeSuggestion.create).not.toHaveBeenCalled();
    expect(logged(db)[0].detail).toContain(
      "case 12 changed while it was being checked; case 13 changed while it was being checked"
    );
  });

  it("counts nothing for a rewrite that was refused", async () => {
    mocks.rewrite.mockResolvedValue({ ok: false, reason: "changed" });
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "update", reason: "Tax", proposed }])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({
      outcome: "no_changes",
      rewritten: 0,
    });
    expect(mocks.tx.repositoryCases.update).not.toHaveBeenCalled();
    expect(mocks.tx.repositoryCaseIssue.updateMany).not.toHaveBeenCalled();
    expect(logged(db)[0].detail).toContain("case 12 could not be rewritten");
  });

  it("notes fields the rewrite could not set", async () => {
    mocks.rewrite.mockResolvedValue({
      ok: true,
      version: 2,
      skippedFields: ["Priority"],
    });
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "update", reason: "Tax", proposed }])
    );
    const db = makeDb();
    await runUpdateCases(db, job);
    expect(logged(db)[0].detail).toContain("case 12: left Priority as it was");
  });

  it("carries on with the other cases when one case's write fails", async () => {
    mocks.rewrite
      .mockRejectedValueOnce(new Error("deadlock"))
      .mockResolvedValueOnce({ ok: true, version: 2, skippedFields: [] });
    mocks.review.mockResolvedValue(
      answer([
        { caseId: 12, action: "update", reason: "Tax", proposed },
        { caseId: 13, action: "update", reason: "Tax", proposed },
      ])
    );
    const db = makeDb({ links: [link(12), link(13)] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runUpdateCases(db, job)).toMatchObject({ rewritten: 1 });
    expect(logged(db)[0].detail).toContain("case 12: deadlock");
  });

  it("notes a write that failed without saying why", async () => {
    mocks.rewrite.mockRejectedValueOnce("boom");
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "update", reason: "Tax", proposed }])
    );
    const db = makeDb();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runUpdateCases(db, job);
    expect(logged(db)[0].detail).toContain("case 12: failed");
  });

  it("still works when the project row or the acting user cannot be read", async () => {
    mocks.review.mockResolvedValue(
      answer(
        [{ caseId: 12, action: "retire", reason: "x" }],
        [{ name: "Account locks", fieldValues: {}, steps: [] }]
      )
    );
    const db = makeDb();
    db.projects.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue(null);
    await runUpdateCases(db, job);
    expect(mocks.actor).toHaveBeenCalledWith(db, "");
    expect(mocks.notify.mock.calls[0][0].projectName).toBe("");
    expect(mocks.persist.mock.calls[0][1]).toEqual({
      userId: "system-automation-user",
      userName: "System",
    });
  });

  it("includes what the model's answer left out in the log", async () => {
    mocks.review.mockResolvedValue(
      answer(
        [{ caseId: 12, action: "unchanged" }],
        [],
        ["no answer for case 12"]
      )
    );
    const db = makeDb();
    await runUpdateCases(db, job);
    expect(logged(db)[0].detail).toBe(
      "checked 1: 0 rewritten, 0 added, 0 deleted, 0 suggested; no answer for case 12"
    );
  });

  it("ignores a decision for a case it did not send", async () => {
    mocks.review.mockResolvedValue(
      answer([{ caseId: 999, action: "retire", reason: "x" }])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({
      outcome: "no_changes",
    });
    expect(mocks.tx.repositoryCases.findFirst).not.toHaveBeenCalled();
  });
});

describe("runUpdateCases: new cases", () => {
  const added = {
    name: "Account locks",
    fieldValues: { Priority: "High" },
    steps: [{ step: "Fail 5 times", expectedResult: "Locked" }],
  };

  it("drafts them in the folder most of the cases are in, in the AI-draft state, linked to the issue", async () => {
    mocks.aiDraftState.mockResolvedValue({ id: 21, name: "AI-Generated" });
    mocks.review.mockResolvedValue(
      answer(
        [
          { caseId: 12, action: "unchanged" },
          { caseId: 13, action: "unchanged" },
          { caseId: 14, action: "unchanged" },
        ],
        [added]
      )
    );
    const db = makeDb({
      links: [
        link(12, { folderId: 60 }),
        link(13, { folderId: 61 }),
        link(14, { folderId: 61 }),
      ],
    });
    expect(await runUpdateCases(db, job)).toMatchObject({
      outcome: "cases_updated",
      added: 1,
    });
    expect(mocks.resolveTarget).toHaveBeenCalledWith(
      7,
      "system-automation-user",
      { folderId: 61 },
      db
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      {
        projectId: 7,
        projectName: "Shop",
        repositoryId: 2,
        folderId: 55,
        folderName: "Drafts",
        templateId: 4,
        templateName: "Template 4",
        stateId: 21,
        stateName: "AI-Generated",
        maxOrder: 3,
        autoGenerateTags: false,
        testCases: [
          {
            id: "added-0",
            name: "Account locks",
            fieldValues: { Priority: "High", Steps: added.steps },
          },
        ],
        fieldMappings: template().fieldMappings,
        linkIssueId: 100,
      },
      { userId: "system-automation-user", userName: "System" }
    );
    expect(mocks.markAiWritten).toHaveBeenCalledWith(db, [900], 100);
  });

  it("uses the rule's own state when it names a usable one, and its tag setting", async () => {
    mocks.aiDraftState.mockResolvedValue({ id: 21, name: "AI-Generated" });
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "unchanged" }], [added])
    );
    const db = makeDb({
      rule: {
        isEnabled: true,
        options: { stateId: 9, autoGenerateTags: true },
      },
      state: { id: 9, name: "Review" },
    });
    await runUpdateCases(db, job);
    expect(mocks.persist.mock.calls[0][0]).toMatchObject({
      stateId: 9,
      stateName: "Review",
      autoGenerateTags: true,
    });
    expect(mocks.aiDraftState).not.toHaveBeenCalled();
  });

  it("keeps the project's default state when there is no AI-draft state and the rule's state is unusable", async () => {
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "unchanged" }], [added])
    );
    const noState = makeDb();
    await runUpdateCases(noState, job);
    expect(mocks.persist.mock.calls[0][0]).toMatchObject({
      stateId: 8,
      stateName: "Draft",
    });
    const badState = makeDb({
      rule: { isEnabled: true, options: { stateId: 99 } },
      state: null,
    });
    await runUpdateCases(badState, job);
    expect(mocks.persist.mock.calls[1][0]).toMatchObject({ stateId: 8 });
  });

  it("adds nothing when the project has nowhere to put them", async () => {
    mocks.resolveTarget.mockResolvedValue(null);
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "unchanged" }], [added])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({
      outcome: "no_changes",
      added: 0,
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(logged(db)[0].detail).toContain("new cases had nowhere to go");
  });

  it("takes new cases only from the most used template's answer", async () => {
    mocks.review.mockImplementation(async (_db: unknown, params: any) =>
      answer(
        params.cases.map((c: any) => ({ caseId: c.id, action: "unchanged" })),
        [{ ...added, name: `From template ${params.template.id}` }]
      )
    );
    const db = makeDb({
      links: [link(12, { templateId: 9 }), link(13), link(14)],
    });
    await runUpdateCases(db, job);
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.persist.mock.calls[0][0].testCases[0].name).toBe(
      "From template 4"
    );
  });

  it("leaves the steps out for a template without a steps field, and reports import errors", async () => {
    mocks.loadTemplate.mockResolvedValue({
      template: { id: 4, name: "Bare", fields: [] },
      fieldMappings: [],
    });
    mocks.persist.mockResolvedValue({
      status: "success",
      importedCount: 0,
      importedIds: [],
      errors: ['Failed to import "Account locks": boom'],
      results: [],
    });
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "unchanged" }], [added])
    );
    const db = makeDb();
    expect(await runUpdateCases(db, job)).toMatchObject({ added: 0 });
    expect(mocks.persist.mock.calls[0][0].testCases[0].fieldValues).toEqual({
      Priority: "High",
    });
    expect(logged(db)[0].detail).toContain(
      'Failed to import "Account locks": boom'
    );
  });
});

describe("runUpdateCases: telling people", () => {
  it("sends each recipient one summary, adding the reviewers of cases that got suggestions", async () => {
    mocks.tx = makeTx({ 12: reviewed, 13: aiDraft });
    mocks.review.mockResolvedValue(
      answer([
        { caseId: 12, action: "update", reason: "Tax", proposed },
        { caseId: 13, action: "update", reason: "Tax", proposed },
      ])
    );
    mocks.recipients.mockResolvedValue(["u1", "rev-1"]);
    const db = makeDb({
      rule: { isEnabled: true, options: { notifyUserIds: ["u1"] } },
      links: [
        link(12, { reviewedById: "rev-1" }),
        link(13, { reviewedById: "rev-2" }),
      ],
      approvals: [
        { entityId: 12, requestedByUserId: "req-1", decidedByUserId: "rev-1" },
      ],
    });
    await runUpdateCases(db, job);
    // Only case 12 got a suggestion, so only its reviewer and requester are added.
    expect(mocks.recipients).toHaveBeenCalledWith(db, {
      projectId: 7,
      issueId: 100,
      options: { notifyUserIds: ["u1"] },
      alsoTell: ["rev-1", "req-1"],
    });
    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mocks.notify.mock.calls.map((c) => c[0].userId)).toEqual([
      "u1",
      "rev-1",
    ]);
    expect(mocks.notify.mock.calls[0][0]).toEqual({
      userId: "u1",
      projectId: 7,
      projectName: "Shop",
      issueId: 100,
      issueKey: "DEMO-42",
      issueTitle: "Checkout totals",
      tenantId: "t1",
      kind: "summary",
      rewritten: 1,
      added: 0,
      deleted: 0,
      suggested: 1,
      deletedNames: [],
    });
    expect(logged(db)).toMatchObject([
      {
        outcome: "cases_updated",
        caseCount: 2,
        detail: "checked 2: 1 rewritten, 0 added, 0 deleted, 1 suggested",
      },
    ]);
  });

  it("names the issue by its own name when it has no tracker key", async () => {
    mocks.review.mockResolvedValue(
      answer([{ caseId: 12, action: "retire", reason: "x" }])
    );
    const db = makeDb({
      issue: {
        id: 100,
        name: "Local 3",
        title: "A bug",
        description: "",
        externalKey: null,
        isDeleted: false,
        isRequirement: false,
        contentUpdatedAt: CHANGED,
      },
    });
    await runUpdateCases(db, job);
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({
      issueKey: "Local 3",
      issueTitle: "A bug",
    });
  });
});
