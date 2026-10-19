import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  performIssueRefreshSystem: vi.fn(),
  resolveSyncedRequirementFlag: vi.fn(),
  composeRunFromCases: vi.fn(),
  executeAutoRun: vi.fn(),
  getIssueSubtreeIds: vi.fn(),
  webhookActorId: vi.fn(),
  enqueueDraftCases: vi.fn(),
  describeCaseFilter: vi.fn(),
}));

vi.mock("~/lib/integrations/services/SyncService", () => ({
  syncService: { performIssueRefreshSystem: mocks.performIssueRefreshSystem },
  resolveSyncedRequirementFlag: mocks.resolveSyncedRequirementFlag,
}));
vi.mock("~/lib/services/impact/autoExecute", () => ({
  executeAutoRun: mocks.executeAutoRun,
}));
vi.mock("~/lib/services/requirementHierarchy", () => ({
  getIssueSubtreeIds: mocks.getIssueSubtreeIds,
}));
vi.mock("./actor", () => ({ webhookActorId: mocks.webhookActorId }));
vi.mock("./enqueueDraftCases", () => ({
  enqueueDraftCases: mocks.enqueueDraftCases,
}));
vi.mock("./composeRun", () => ({
  composeRunFromCases: mocks.composeRunFromCases,
}));
vi.mock("./caseFilter", () => ({
  describeCaseFilter: mocks.describeCaseFilter,
}));

import {
  IssueSyncBusyError,
  hasTrackerRules,
  runTrackerActions,
  type TrackerActionsJob,
} from "./runTrackerActions";

const SYSTEM = "system-user";

const job: TrackerActionsJob = {
  deliveryId: "del-1",
  webhookConfigId: "whc-1",
  projectId: 7,
  adapterType: "JIRA",
  externalKey: "DEMO-42",
  tenantId: "tenant-a",
};

type Rule = {
  id: string;
  trigger: string;
  action: string;
  filter: unknown;
  options: unknown;
};

const rule = (overrides: Partial<Rule> & Pick<Rule, "id">): Rule => ({
  trigger: "ISSUE_CREATED",
  action: "CREATE_RUN",
  filter: {},
  options: {},
  ...overrides,
});

const outcome = (overrides: Record<string, unknown> = {}) => ({
  issueId: 100,
  projectId: 7,
  created: false,
  previousStatus: "To Do",
  status: "Ready for QA",
  issueTypeId: "10001",
  labels: ["qa"],
  isRequirement: false,
  key: "DEMO-42",
  title: "Checkout totals",
  url: "https://jira.example/browse/DEMO-42",
  ...overrides,
});

function makeDb(rules: Rule[], opts: { integration?: boolean } = {}) {
  return {
    webhookAction: {
      findMany: vi.fn().mockResolvedValue(rules),
      count: vi.fn(),
    },
    projectIntegration: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          opts.integration === false ? null : { integrationId: 3 }
        ),
    },
    projects: {
      findUnique: vi.fn().mockResolvedValue({ createdBy: "creator-1" }),
    },
    webhookDelivery: { update: vi.fn().mockResolvedValue({}) },
    repositoryCaseIssue: {
      findMany: vi.fn().mockResolvedValue([{ caseId: 11 }, { caseId: 12 }]),
      count: vi.fn().mockResolvedValue(0),
    },
    webhookActionLog: { create: vi.fn().mockResolvedValue({}) },
    executionTarget: { findUnique: vi.fn().mockResolvedValue(null) },
    issue: { findUnique: vi.fn().mockResolvedValue({ isDeleted: false }) },
  };
}

const logged = (db: ReturnType<typeof makeDb>) =>
  db.webhookActionLog.create.mock.calls.map((c: any[]) => c[0].data);

describe("runTrackerActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.webhookActorId.mockResolvedValue(SYSTEM);
    mocks.resolveSyncedRequirementFlag.mockResolvedValue(false);
    mocks.getIssueSubtreeIds.mockResolvedValue([]);
    mocks.performIssueRefreshSystem.mockResolvedValue({
      success: true,
      issue: outcome(),
    });
    mocks.composeRunFromCases.mockResolvedValue({
      created: true,
      testRunId: 500,
      caseCount: 2,
    });
    mocks.executeAutoRun.mockResolvedValue({ requested: true });
  });

  it("loads only enabled tracker rules that import issues, create runs or draft cases, in order", async () => {
    const db = makeDb([]);
    await runTrackerActions(db, job);
    expect(db.webhookAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          webhookConfigId: "whc-1",
          isEnabled: true,
          trigger: {
            in: ["ISSUE_EVENT", "ISSUE_CREATED", "ISSUE_STATUS_ENTERED"],
          },
          action: { in: ["IMPORT_ISSUE", "CREATE_RUN", "DRAFT_CASES"] },
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      })
    );
  });

  it("is ignored when the project has no active integration for the tracker", async () => {
    const db = makeDb([rule({ id: "r1" })], { integration: false });

    const result = await runTrackerActions(db, job);

    expect(result).toEqual({ outcome: "no_integration" });
    expect(db.projectIntegration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 7,
          isActive: true,
          integration: { provider: "JIRA", isDeleted: false },
        },
      })
    );
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "ignored:no_integration" },
    });
    expect(mocks.performIssueRefreshSystem).not.toHaveBeenCalled();
  });

  it("is ignored for an adapter with no integration provider", async () => {
    const db = makeDb([rule({ id: "r1" })]);
    const result = await runTrackerActions(db, {
      ...job,
      adapterType: "SLACK" as any,
    });
    expect(result).toEqual({ outcome: "no_integration" });
    expect(db.projectIntegration.findFirst).not.toHaveBeenCalled();
  });

  it("refreshes the issue as the webhook actor, scoped to the project", async () => {
    const db = makeDb([]);
    await runTrackerActions(db, job);

    expect(mocks.webhookActorId).toHaveBeenCalledWith(db, "creator-1");
    expect(mocks.performIssueRefreshSystem).toHaveBeenCalledWith(
      3,
      "DEMO-42",
      expect.objectContaining({
        dbClient: db,
        createIfMissing: expect.objectContaining({
          projectId: 7,
          createdById: SYSTEM,
          shouldCreate: expect.any(Function),
        }),
      })
    );
  });

  describe("shouldCreate", () => {
    const shouldCreateFor = async (rules: Rule[]) => {
      const db = makeDb(rules);
      await runTrackerActions(db, job);
      const options = mocks.performIssueRefreshSystem.mock.calls[0][2];
      return options.createIfMissing.shouldCreate as (
        issueData: any
      ) => Promise<boolean>;
    };
    const issueData = {
      id: "1",
      key: "DEMO-42",
      title: "x",
      status: "Ready for QA",
      issueType: { id: "10001", name: "Story" },
      labels: ["qa"],
    };

    it("declines without an Import issues rule", async () => {
      const shouldCreate = await shouldCreateFor([rule({ id: "run" })]);
      expect(await shouldCreate(issueData)).toBe(false);
      expect(mocks.resolveSyncedRequirementFlag).not.toHaveBeenCalled();
    });

    it("imports when an Import issues rule takes the new issue", async () => {
      const shouldCreate = await shouldCreateFor([
        rule({
          id: "imp",
          action: "IMPORT_ISSUE",
          filter: { labels: ["QA"], issueTypeIds: ["10001"] },
        }),
      ]);
      expect(await shouldCreate(issueData)).toBe(true);
      expect(mocks.resolveSyncedRequirementFlag).toHaveBeenCalledWith(
        expect.anything(),
        3,
        7,
        { issueTypeId: "10001", labels: ["qa"] }
      );
    });

    it("declines when every Import issues rule filters the issue out", async () => {
      const shouldCreate = await shouldCreateFor([
        rule({
          id: "imp",
          action: "IMPORT_ISSUE",
          filter: { labels: ["frontend"] },
        }),
        rule({
          id: "imp-req",
          action: "IMPORT_ISSUE",
          trigger: "ISSUE_EVENT",
          filter: { requirementsOnly: true },
        }),
      ]);
      expect(await shouldCreate(issueData)).toBe(false);
      mocks.resolveSyncedRequirementFlag.mockResolvedValue(true);
      expect(await shouldCreate(issueData)).toBe(true);
    });

    it("lets a status rule import an issue created in one of its statuses", async () => {
      const shouldCreate = await shouldCreateFor([
        rule({
          id: "imp",
          action: "IMPORT_ISSUE",
          trigger: "ISSUE_STATUS_ENTERED",
          filter: { statuses: ["ready for qa"] },
        }),
      ]);
      expect(await shouldCreate(issueData)).toBe(true);
      expect(await shouldCreate({ ...issueData, status: "To Do" })).toBe(false);
    });
  });

  it("throws IssueSyncBusyError when another sync holds the issue", async () => {
    mocks.performIssueRefreshSystem.mockResolvedValue({
      success: true,
      locked: true,
    });
    const db = makeDb([rule({ id: "r1" })]);
    const promise = runTrackerActions(db, job);
    await expect(promise).rejects.toBeInstanceOf(IssueSyncBusyError);
    await expect(promise).rejects.toThrow("DEMO-42");
    expect(mocks.composeRunFromCases).not.toHaveBeenCalled();
  });

  it("is ignored when the unknown issue wasn't imported", async () => {
    mocks.performIssueRefreshSystem.mockResolvedValue({
      success: true,
      notImported: true,
    });
    const db = makeDb([rule({ id: "r1" })]);

    expect(await runTrackerActions(db, job)).toEqual({
      outcome: "not_imported",
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "ignored:not_imported" },
    });
    expect(mocks.composeRunFromCases).not.toHaveBeenCalled();
  });

  it("records a sync failure on the delivery", async () => {
    mocks.performIssueRefreshSystem.mockResolvedValue({
      success: false,
      error: "upstream 502",
    });
    const db = makeDb([rule({ id: "r1" })]);

    expect(await runTrackerActions(db, job)).toEqual({
      outcome: "sync_failed",
      detail: "upstream 502",
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "sync:upstream 502" },
    });
  });

  it("records a refresh that wrote no issue as a sync failure", async () => {
    mocks.performIssueRefreshSystem.mockResolvedValue({ success: true });
    const db = makeDb([]);
    expect(await runTrackerActions(db, job)).toEqual({
      outcome: "sync_failed",
      detail: "no issue",
    });
  });

  it("logs issue_imported for each Import issues rule the created issue fires", async () => {
    mocks.performIssueRefreshSystem.mockResolvedValue({
      success: true,
      issue: outcome({ created: true, previousStatus: null }),
    });
    const db = makeDb([
      rule({ id: "imp-1", action: "IMPORT_ISSUE", trigger: "ISSUE_EVENT" }),
      rule({
        id: "imp-2",
        action: "IMPORT_ISSUE",
        filter: { labels: ["other"] },
      }),
      rule({ id: "imp-3", action: "IMPORT_ISSUE", trigger: "ISSUE_CREATED" }),
    ]);

    const result = await runTrackerActions(db, job);

    expect(result).toEqual({ outcome: "done", issueId: 100, runIds: [] });
    expect(logged(db)).toEqual([
      expect.objectContaining({
        webhookActionId: "imp-1",
        webhookConfigId: "whc-1",
        deliveryId: "del-1",
        projectId: 7,
        issueId: 100,
        outcome: "issue_imported",
      }),
      expect.objectContaining({
        webhookActionId: "imp-3",
        outcome: "issue_imported",
      }),
    ]);
    // Nothing to annotate on the delivery.
    expect(db.webhookDelivery.update).not.toHaveBeenCalled();
  });

  it("logs nothing for import rules when the issue already existed", async () => {
    const db = makeDb([
      rule({ id: "imp-1", action: "IMPORT_ISSUE", trigger: "ISSUE_EVENT" }),
    ]);
    await runTrackerActions(db, job);
    expect(logged(db)).toEqual([]);
  });

  it("creates a run for a created issue from its linked cases, as the System user", async () => {
    mocks.performIssueRefreshSystem.mockResolvedValue({
      success: true,
      issue: outcome({ created: true, previousStatus: null }),
    });
    const db = makeDb([rule({ id: "run-1", trigger: "ISSUE_CREATED" })]);

    const result = await runTrackerActions(db, job);

    expect(result).toEqual({ outcome: "done", issueId: 100, runIds: [500] });
    expect(db.repositoryCaseIssue.findMany).toHaveBeenCalledWith({
      where: { issueId: { in: [100] } },
      orderBy: { caseId: "asc" },
      select: { caseId: true },
    });
    expect(mocks.getIssueSubtreeIds).not.toHaveBeenCalled();
    expect(mocks.composeRunFromCases).toHaveBeenCalledWith(db, {
      projectId: 7,
      name: "DEMO-42: Checkout totals",
      caseIds: [11, 12],
      links: [
        {
          label: "DEMO-42: Checkout totals",
          url: "https://jira.example/browse/DEMO-42",
        },
        { label: "Issue created → Create Test Run", url: null },
      ],
      issueIds: [100],
      createdById: SYSTEM,
      tenantId: "tenant-a",
    });
    expect(logged(db)).toEqual([
      expect.objectContaining({
        webhookActionId: "run-1",
        outcome: "run_created",
        testRunId: 500,
        caseCount: 2,
      }),
    ]);
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:500", error: null },
    });
  });

  it("hands the rule's test case filters to the composer and names them in the run's description", async () => {
    const caseFilter = [
      { dimension: "automated", operator: "is", values: [1] },
    ];
    mocks.describeCaseFilter.mockResolvedValueOnce("Automation: Is Automated");
    mocks.performIssueRefreshSystem.mockResolvedValue({
      success: true,
      issue: outcome({ created: true }),
    });
    const db = makeDb([rule({ id: "run-1", options: { caseFilter } })]);

    await runTrackerActions(db, job);

    expect(mocks.describeCaseFilter).toHaveBeenCalledWith(db, 7, caseFilter);
    expect(mocks.composeRunFromCases).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        caseIds: [11, 12],
        caseFilter,
        links: [
          {
            label: "DEMO-42: Checkout totals",
            url: "https://jira.example/browse/DEMO-42",
          },
          {
            label:
              "Issue created → Create Test Run · Test case filters: Automation: Is Automated",
            url: null,
          },
        ],
      })
    );
  });

  it("creates a run when the issue enters a chosen status (case-insensitive), naming the status", async () => {
    const db = makeDb([
      rule({
        id: "run-1",
        trigger: "ISSUE_STATUS_ENTERED",
        filter: { statuses: ["ready for qa"] },
      }),
    ]);

    const result = await runTrackerActions(db, job);

    expect(result).toEqual({ outcome: "done", issueId: 100, runIds: [500] });
    expect(mocks.composeRunFromCases).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        links: [
          {
            label: "DEMO-42: Checkout totals",
            url: "https://jira.example/browse/DEMO-42",
          },
          {
            label: "Issue status changes → Create Test Run · Ready for QA",
            url: null,
          },
        ],
      })
    );
  });

  it("acts on nothing for an issue deleted in TestPlanIt", async () => {
    const db = makeDb([
      rule({
        id: "run-1",
        trigger: "ISSUE_STATUS_ENTERED",
        filter: { statuses: ["ready for qa"] },
      }),
    ]);
    db.issue.findUnique.mockResolvedValueOnce({ isDeleted: true });

    const result = await runTrackerActions(db, job);

    expect(result).toEqual({ outcome: "done", issueId: 100, runIds: [] });
    expect(mocks.composeRunFromCases).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "ignored:issue_deleted" },
    });
  });

  it("doesn't create a run when the status didn't change or isn't chosen", async () => {
    mocks.performIssueRefreshSystem.mockResolvedValueOnce({
      success: true,
      issue: outcome({ previousStatus: "READY FOR QA" }),
    });
    const statusRule = rule({
      id: "run-1",
      trigger: "ISSUE_STATUS_ENTERED",
      filter: { statuses: ["Ready for QA"] },
    });
    let db = makeDb([statusRule]);
    expect(await runTrackerActions(db, job)).toEqual({
      outcome: "done",
      issueId: 100,
      runIds: [],
    });

    db = makeDb([{ ...statusRule, filter: { statuses: ["Done"] } }]);
    await runTrackerActions(db, job);
    expect(mocks.composeRunFromCases).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).not.toHaveBeenCalled();
  });

  it("takes the child issues' cases when the rule includes child issues", async () => {
    mocks.getIssueSubtreeIds.mockResolvedValue([101, 102]);
    const db = makeDb([
      rule({
        id: "run-1",
        trigger: "ISSUE_EVENT",
        options: { includeChildIssues: true },
      }),
    ]);

    await runTrackerActions(db, job);

    expect(mocks.getIssueSubtreeIds).toHaveBeenCalledWith(100, 7, db);
    expect(db.repositoryCaseIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId: { in: [100, 101, 102] } },
      })
    );
    // The run links only the issue the event was about.
    expect(mocks.composeRunFromCases).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ issueIds: [100] })
    );
  });

  it("logs a run with no cases and notes it on the delivery", async () => {
    mocks.composeRunFromCases.mockResolvedValue({
      created: false,
      reason: "no_cases",
    });
    const db = makeDb([rule({ id: "run-1", trigger: "ISSUE_EVENT" })]);

    expect(await runTrackerActions(db, job)).toEqual({
      outcome: "done",
      issueId: 100,
      runIds: [],
    });
    expect(logged(db)).toEqual([
      expect.objectContaining({
        webhookActionId: "run-1",
        outcome: "no_cases",
      }),
    ]);
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "ignored:no_cases" },
    });
  });

  it("notes a failure on the delivery over a rule that found no cases", async () => {
    mocks.composeRunFromCases
      .mockResolvedValueOnce({ created: false, reason: "no_cases" })
      .mockResolvedValueOnce({ created: false, reason: "no_workflow" });
    const db = makeDb([
      rule({ id: "run-1", trigger: "ISSUE_EVENT" }),
      rule({ id: "run-2", trigger: "ISSUE_EVENT" }),
    ]);

    await runTrackerActions(db, job);

    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "run:no_workflow" },
    });
  });

  it("hands a Draft test cases rule to its own job and notes it as queued", async () => {
    mocks.enqueueDraftCases.mockResolvedValue(undefined);
    const db = makeDb([
      rule({ id: "draft-1", trigger: "ISSUE_EVENT", action: "DRAFT_CASES" }),
    ]);

    expect(await runTrackerActions(db, job)).toEqual({
      outcome: "done",
      issueId: 100,
      runIds: [],
    });
    expect(logged(db)).toEqual([
      expect.objectContaining({
        webhookActionId: "draft-1",
        outcome: "draft_queued",
      }),
    ]);
    expect(mocks.enqueueDraftCases).toHaveBeenCalledWith({
      deliveryId: "del-1",
      webhookConfigId: "whc-1",
      webhookActionId: "draft-1",
      projectId: 7,
      issueId: 100,
      tenantId: "tenant-a",
    });
    expect(mocks.composeRunFromCases).not.toHaveBeenCalled();
  });

  it("leaves an issue that already has test cases alone instead of drafting", async () => {
    const db = makeDb([
      rule({ id: "draft-1", trigger: "ISSUE_EVENT", action: "DRAFT_CASES" }),
    ]);
    db.repositoryCaseIssue.count.mockResolvedValue(2);

    await runTrackerActions(db, job);

    expect(logged(db)).toEqual([
      expect.objectContaining({
        webhookActionId: "draft-1",
        outcome: "has_cases",
      }),
    ]);
    expect(mocks.enqueueDraftCases).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "ignored:has_cases" },
    });
  });

  it("executes the run when the rule says so, and logs a refused execution", async () => {
    mocks.executeAutoRun.mockResolvedValue({
      requested: false,
      code: "TARGET_DISABLED",
    });
    const db = makeDb([
      rule({
        id: "run-1",
        trigger: "ISSUE_EVENT",
        options: { autoExecute: { targetId: 4, ref: "main" } },
      }),
    ]);
    db.executionTarget.findUnique.mockResolvedValue({ name: "Nightly CI" });

    await runTrackerActions(db, job);

    expect(mocks.composeRunFromCases).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        links: expect.arrayContaining([
          {
            label: "Any issue event → Create Test Run · Target: Nightly CI",
            url: null,
          },
        ]),
      })
    );
    expect(mocks.executeAutoRun).toHaveBeenCalledWith(db, {
      autoExecute: { targetId: 4, ref: "main" },
      testRunId: 500,
      projectId: 7,
      tenantId: "tenant-a",
    });
    expect(logged(db)).toEqual([
      expect.objectContaining({ outcome: "run_created", testRunId: 500 }),
      expect.objectContaining({
        outcome: "execute_failed",
        testRunId: 500,
        detail: "TARGET_DISABLED",
      }),
    ]);
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:500", error: "execute:target_disabled" },
    });
  });

  it("doesn't execute a run whose rule has no target", async () => {
    const db = makeDb([rule({ id: "run-1", trigger: "ISSUE_EVENT" })]);
    await runTrackerActions(db, job);
    expect(mocks.executeAutoRun).not.toHaveBeenCalled();
  });

  it("points the delivery at the first run when several rules fire", async () => {
    mocks.composeRunFromCases
      .mockResolvedValueOnce({ created: true, testRunId: 501, caseCount: 1 })
      .mockResolvedValueOnce({ created: true, testRunId: 502, caseCount: 1 });
    const db = makeDb([
      rule({ id: "run-1", trigger: "ISSUE_EVENT" }),
      rule({
        id: "run-2",
        trigger: "ISSUE_STATUS_ENTERED",
        filter: { statuses: ["Ready for QA"] },
      }),
    ]);

    expect(await runTrackerActions(db, job)).toEqual({
      outcome: "done",
      issueId: 100,
      runIds: [501, 502],
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:501", error: null },
    });
  });

  it("logs a rule that throws and carries on with the next", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.composeRunFromCases
      .mockRejectedValueOnce(new Error("db exploded"))
      .mockResolvedValueOnce({ created: true, testRunId: 502, caseCount: 1 });
    const db = makeDb([
      rule({ id: "run-1", trigger: "ISSUE_EVENT" }),
      rule({ id: "run-2", trigger: "ISSUE_EVENT" }),
    ]);

    expect(await runTrackerActions(db, job)).toEqual({
      outcome: "done",
      issueId: 100,
      runIds: [502],
    });
    expect(logged(db)).toEqual([
      expect.objectContaining({
        webhookActionId: "run-1",
        outcome: "error",
        detail: "db exploded",
      }),
      expect.objectContaining({
        webhookActionId: "run-2",
        outcome: "run_created",
      }),
    ]);
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:502", error: "run:error" },
    });
    errorSpy.mockRestore();
  });

  it("survives a delivery annotation failure", async () => {
    const db = makeDb([], { integration: false });
    db.webhookDelivery.update.mockRejectedValue(new Error("gone"));
    await expect(runTrackerActions(db, job)).resolves.toEqual({
      outcome: "no_integration",
    });
  });
});

describe("hasTrackerRules", () => {
  it("counts enabled tracker rules that import issues, create runs or draft cases", async () => {
    const db = { webhookAction: { count: vi.fn().mockResolvedValue(2) } };
    expect(await hasTrackerRules(db, "whc-1")).toBe(true);
    expect(db.webhookAction.count).toHaveBeenCalledWith({
      where: {
        webhookConfigId: "whc-1",
        isEnabled: true,
        trigger: {
          in: ["ISSUE_EVENT", "ISSUE_CREATED", "ISSUE_STATUS_ENTERED"],
        },
        action: { in: ["IMPORT_ISSUE", "CREATE_RUN", "DRAFT_CASES"] },
      },
    });
  });

  it("is false with none", async () => {
    const db = { webhookAction: { count: vi.fn().mockResolvedValue(0) } };
    expect(await hasTrackerRules(db, "whc-1")).toBe(false);
  });
});
