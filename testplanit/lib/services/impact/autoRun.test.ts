import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCompose, mockExecute } = vi.hoisted(() => ({
  mockCompose: vi.fn(),
  mockExecute: vi.fn(),
}));
vi.mock("~/lib/webhooks/actions/composeRun", () => ({
  composeRunFromCases: (...args: unknown[]) => mockCompose(...args),
}));
vi.mock("./autoExecute", () => ({
  executeAutoRun: (...args: unknown[]) => mockExecute(...args),
}));

import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";
import { createRunFromAnalysis, runAnalysisActions } from "./autoRun";

type LogRow = {
  webhookActionId: string | null;
  analysisId: number;
  testRunId: number | null;
  outcome?: string;
};

/**
 * A db whose webhookActionLog answers findFirst from the rows written to it,
 * so runs composed earlier in the same job are seen by later rules.
 */
function makeDb(
  analysis: any,
  opts: { systemUser?: boolean; logs?: LogRow[] } = {}
) {
  const logs: LogRow[] = [...(opts.logs ?? [])];
  const state = { analysis };
  const db = {
    impactAnalysis: {
      findUnique: vi.fn(async (_args: any) =>
        state.analysis ? { ...state.analysis } : null
      ),
      update: vi.fn(async ({ data }: any) => {
        state.analysis = { ...state.analysis, ...data };
        return state.analysis;
      }),
    },
    impactAnalysisCase: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.systemUser === false ? null : { id: SYSTEM_AUTOMATION_USER_ID }
        ),
    },
    webhookActionLog: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = logs.find(
          (l) =>
            (where.webhookActionId === undefined ||
              (typeof where.webhookActionId === "object"
                ? l.webhookActionId !== null
                : l.webhookActionId === where.webhookActionId)) &&
            (where.outcome === undefined || l.outcome === where.outcome) &&
            l.analysisId === where.analysisId &&
            (typeof where.testRunId === "number"
              ? l.testRunId === where.testRunId
              : l.testRunId !== null)
        );
        return row ? { id: "log", testRunId: row.testRunId } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        logs.push({
          webhookActionId: data.webhookActionId,
          analysisId: data.analysisId,
          testRunId: data.testRunId,
          outcome: data.outcome,
        });
        return data;
      }),
    },
    webhookDelivery: { update: vi.fn().mockResolvedValue({}) },
  };
  return db;
}

const autoRun = {
  trigger: "pull_request" as const,
  label: "PR #12: Fix checkout",
  url: "https://github.com/acme/app/pull/12",
  deliveryId: "del-1",
  webhookConfigId: "whc-1",
};
const analysis = {
  id: 77,
  projectId: 3,
  testRunId: null,
  project: { createdBy: "owner-1" },
  cases: [{ caseId: 10 }, { caseId: 11 }],
};
const rule = { actionId: "act-1", minScore: null };

let nextRunId = 300;

describe("createRunFromAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextRunId = 300;
    mockCompose.mockImplementation(async (_db: unknown, input: any) => ({
      created: true,
      testRunId: nextRunId++,
      caseCount: input.caseIds.length,
    }));
  });

  it("composes a run of the affected cases as the System user, links it, and marks the acceptance", async () => {
    const db = makeDb(analysis);

    const result = await createRunFromAnalysis(db, 77, autoRun, rule, "t-1");

    expect(result).toEqual({ created: true, testRunId: 300, caseCount: 2 });
    expect(
      db.impactAnalysis.findUnique.mock.calls[0][0].select.cases.where
    ).toEqual({ suggested: true, tier: { in: ["pinned", "affected"] } });
    expect(mockCompose).toHaveBeenCalledWith(db, {
      projectId: 3,
      name: "PR #12: Fix checkout",
      caseIds: [10, 11],
      links: [
        {
          label: "PR #12: Fix checkout",
          url: "https://github.com/acme/app/pull/12",
        },
      ],
      createdById: SYSTEM_AUTOMATION_USER_ID,
      tenantId: "t-1",
    });
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { testRunId: 300 },
    });
    expect(db.impactAnalysisCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { analysisId: 77, suggested: true, caseId: { in: [10, 11] } },
        data: expect.objectContaining({
          accepted: true,
          reviewedById: SYSTEM_AUTOMATION_USER_ID,
        }),
      })
    );
    expect(db.impactAnalysisCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          analysisId: 77,
          suggested: true,
          caseId: { notIn: [10, 11] },
        },
        data: expect.objectContaining({ accepted: false }),
      })
    );
  });

  it("acts as the project creator when the System user is missing", async () => {
    const db = makeDb(analysis, { systemUser: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await createRunFromAnalysis(db, 77, autoRun, rule);

    expect(mockCompose.mock.calls[0][1].createdById).toBe("owner-1");
    warn.mockRestore();
  });

  it("passes every event link through, so a merge push names its pull request", async () => {
    const db = makeDb(analysis);
    const links = [
      { label: "main a…b", url: "https://github.com/acme/app/compare/a...b" },
      {
        label: "PR #12: Fix checkout",
        url: "https://github.com/acme/app/pull/12",
      },
    ];
    await createRunFromAnalysis(
      db,
      77,
      { trigger: "push", label: "main a…b (PR #12)", links },
      rule
    );
    expect(mockCompose.mock.calls[0][1]).toMatchObject({
      name: "main a…b (PR #12)",
      links,
    });
  });

  it("adds a line naming the rule and its settings after the event's links", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(db, 77, autoRun, {
      actionId: "act-1",
      trigger: "CODE_PULL_REQUEST",
      minScore: 90,
    });
    expect(mockCompose.mock.calls[0][1].links).toEqual([
      { label: autoRun.label, url: autoRun.url },
      {
        label: "Pull requests → Create Test Run · Minimum score: 90",
        url: null,
      },
    ]);
  });

  it("uses the label alone when the event had no link", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(
      db,
      77,
      { trigger: "push", label: "main a…b" },
      rule
    );
    expect(mockCompose.mock.calls[0][1].links).toEqual([
      { label: "main a…b", url: null },
    ]);
  });

  it("takes every suggested case at or above the rule's minimum score instead of the tiers", async () => {
    const db = makeDb(analysis);

    await createRunFromAnalysis(db, 77, autoRun, {
      actionId: "act-1",
      minScore: 70,
    });

    expect(
      db.impactAnalysis.findUnique.mock.calls[0][0].select.cases
    ).toMatchObject({
      where: { suggested: true, score: { gte: 70 } },
      orderBy: [{ score: "desc" }, { caseId: "asc" }],
    });
  });

  it("treats a minimum score of 0 as a score filter", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(db, 77, autoRun, {
      actionId: "act-1",
      minScore: 0,
    });
    expect(
      db.impactAnalysis.findUnique.mock.calls[0][0].select.cases.where
    ).toEqual({ suggested: true, score: { gte: 0 } });
  });

  it("reports a missing analysis", async () => {
    const db = makeDb(null);
    expect(await createRunFromAnalysis(db, 77, autoRun, rule)).toEqual({
      created: false,
      reason: "analysis_missing",
    });
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it("passes a compose refusal through without linking the analysis", async () => {
    mockCompose.mockResolvedValueOnce({ created: false, reason: "no_cases" });
    const db = makeDb(analysis);

    expect(await createRunFromAnalysis(db, 77, autoRun, rule)).toEqual({
      created: false,
      reason: "no_cases",
    });
    expect(db.impactAnalysis.update).not.toHaveBeenCalled();
    expect(db.impactAnalysisCase.updateMany).not.toHaveBeenCalled();
  });

  it("reports the run a rule already composed from this analysis instead of a second one", async () => {
    const db = makeDb(
      { ...analysis, testRunId: 44 },
      { logs: [{ webhookActionId: "act-1", analysisId: 77, testRunId: 44 }] }
    );

    expect(await createRunFromAnalysis(db, 77, autoRun, rule)).toEqual({
      created: false,
      reason: "already_linked",
      testRunId: 44,
    });
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it("lets a hand-composed run linked to the analysis block every rule", async () => {
    const db = makeDb({ ...analysis, testRunId: 44 });

    expect(await createRunFromAnalysis(db, 77, autoRun, rule)).toEqual({
      created: false,
      reason: "already_linked",
      testRunId: 44,
    });
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it("blocks a job queued before rules existed once the analysis is linked to any run", async () => {
    const db = makeDb(
      { ...analysis, testRunId: 44 },
      {
        logs: [
          {
            webhookActionId: "act-9",
            analysisId: 77,
            testRunId: 44,
            outcome: "run_created",
          },
        ],
      }
    );

    expect(
      await createRunFromAnalysis(db, 77, autoRun, { actionId: null })
    ).toEqual({ created: false, reason: "already_linked", testRunId: 44 });
  });

  it("still composes for a rule when the linked run came from another rule, without relinking", async () => {
    const db = makeDb(
      { ...analysis, testRunId: 44 },
      {
        logs: [
          {
            webhookActionId: "act-9",
            analysisId: 77,
            testRunId: 44,
            outcome: "run_created",
          },
        ],
      }
    );

    expect(await createRunFromAnalysis(db, 77, autoRun, rule)).toEqual({
      created: true,
      testRunId: 300,
      caseCount: 2,
    });
    expect(db.impactAnalysis.update).not.toHaveBeenCalled();
    expect(db.impactAnalysisCase.updateMany).not.toHaveBeenCalled();
  });
});

describe("runAnalysisActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextRunId = 300;
    mockCompose.mockImplementation(async (_db: unknown, input: any) => ({
      created: true,
      testRunId: nextRunId++,
      caseCount: input.caseIds.length,
    }));
    mockExecute.mockResolvedValue({ requested: true, executionId: 9 });
  });

  it("composes one run per matching rule, logs each, and points the delivery at the first", async () => {
    const db = makeDb(analysis);

    await runAnalysisActions(
      db,
      77,
      3,
      {
        ...autoRun,
        actions: [
          { actionId: "act-1", minScore: null },
          { actionId: "act-2", minScore: 50 },
        ],
      },
      "t-1"
    );

    expect(mockCompose).toHaveBeenCalledTimes(2);
    expect(db.webhookActionLog.create).toHaveBeenCalledTimes(2);
    expect(db.webhookActionLog.create.mock.calls[0][0].data).toMatchObject({
      webhookActionId: "act-1",
      webhookConfigId: "whc-1",
      deliveryId: "del-1",
      projectId: 3,
      analysisId: 77,
      outcome: "run_created",
      testRunId: 300,
      caseCount: 2,
    });
    expect(db.webhookActionLog.create.mock.calls[1][0].data).toMatchObject({
      webhookActionId: "act-2",
      outcome: "run_created",
      testRunId: 301,
    });
    // only the first run links the analysis
    expect(db.impactAnalysis.update).toHaveBeenCalledTimes(1);
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:300", error: null },
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("composes the single run a job queued before rules existed asked for, with no log and no execution", async () => {
    const db = makeDb(analysis);

    await runAnalysisActions(db, 77, 3, { ...autoRun, minScore: 60 });

    expect(mockCompose).toHaveBeenCalledTimes(1);
    expect(
      db.impactAnalysis.findUnique.mock.calls[0][0].select.cases.where
    ).toEqual({ suggested: true, score: { gte: 60 } });
    // a log row is still written for the webhook, without a rule
    expect(db.webhookActionLog.create.mock.calls[0][0].data).toMatchObject({
      webhookActionId: null,
      outcome: "run_created",
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:300", error: null },
    });
  });

  it("writes no log rows without a webhook config", async () => {
    const db = makeDb(analysis);
    await runAnalysisActions(db, 77, 3, {
      trigger: "push",
      label: "x",
      actions: [{ actionId: "act-1" }],
    });
    expect(db.webhookActionLog.create).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).not.toHaveBeenCalled();
  });

  it("requests execution of a rule's run when the rule says to", async () => {
    const db = makeDb(analysis);
    const autoExecute = { targetId: 4, ref: "main" };

    await runAnalysisActions(
      db,
      77,
      3,
      { ...autoRun, actions: [{ actionId: "act-1", autoExecute }] },
      "t-1"
    );

    expect(mockExecute).toHaveBeenCalledWith(db, {
      autoExecute,
      testRunId: 300,
      projectId: 3,
      tenantId: "t-1",
    });
    expect(db.webhookActionLog.create).toHaveBeenCalledTimes(1);
  });

  it("logs a refused execution on the rule and the delivery", async () => {
    mockExecute.mockResolvedValue({
      requested: false,
      code: "TARGET_DISABLED",
    });
    const db = makeDb(analysis);

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1", autoExecute: { targetId: 4 } }],
    });

    expect(db.webhookActionLog.create.mock.calls[1][0].data).toMatchObject({
      webhookActionId: "act-1",
      outcome: "execute_failed",
      testRunId: 300,
      detail: "TARGET_DISABLED",
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:300", error: "execute:target_disabled" },
    });
  });

  it("says so on the delivery when the analysis found no affected cases", async () => {
    mockCompose.mockResolvedValue({ created: false, reason: "no_cases" });
    const db = makeDb({ ...analysis, cases: [] });

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1" }],
    });

    expect(db.webhookActionLog.create.mock.calls[0][0].data).toMatchObject({
      outcome: "no_cases",
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "analysis:77", error: "ignored:no_affected_cases" },
    });
  });

  it("notes a failure on the delivery over a rule that found no cases", async () => {
    mockCompose
      .mockResolvedValueOnce({ created: false, reason: "no_cases" })
      .mockResolvedValueOnce({ created: false, reason: "no_workflow" });
    const db = makeDb(analysis);

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1" }, { actionId: "act-2" }],
    });

    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "analysis:77", error: "run:no_workflow" },
    });
  });

  it("records other refusals by reason", async () => {
    mockCompose.mockResolvedValue({ created: false, reason: "no_workflow" });
    const db = makeDb(analysis);

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1" }],
    });

    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "analysis:77", error: "run:no_workflow" },
    });
  });

  it("logs already_composed and points the delivery at the existing run on a repeat", async () => {
    const db = makeDb(
      { ...analysis, testRunId: 44 },
      { logs: [{ webhookActionId: "act-1", analysisId: 77, testRunId: 44 }] }
    );

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1", autoExecute: { targetId: 4 } }],
    });

    expect(mockCompose).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(db.webhookActionLog.create.mock.calls[0][0].data).toMatchObject({
      outcome: "already_composed",
      testRunId: 44,
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:44", error: null },
    });
  });

  it("composes the second rule's run after the first rule linked the analysis in the same job", async () => {
    const db = makeDb(analysis);

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1" }, { actionId: "act-2" }],
    });

    expect(mockCompose).toHaveBeenCalledTimes(2);
    expect(
      db.webhookActionLog.create.mock.calls.map((c: any) => c[0].data.outcome)
    ).toEqual(["run_created", "run_created"]);
  });

  it("blocks every rule in a job when the analysis's run was composed by hand", async () => {
    const db = makeDb({ ...analysis, testRunId: 44 });

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1" }, { actionId: "act-2" }],
    });

    expect(mockCompose).not.toHaveBeenCalled();
    expect(
      db.webhookActionLog.create.mock.calls.map((c: any) => c[0].data.outcome)
    ).toEqual(["already_composed", "already_composed"]);
  });

  it("blocks the first rule when the analysis's run was composed by hand", async () => {
    const db = makeDb({ ...analysis, testRunId: 44 });

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1" }],
    });

    expect(mockCompose).not.toHaveBeenCalled();
    expect(db.webhookActionLog.create.mock.calls[0][0].data).toMatchObject({
      outcome: "already_composed",
      testRunId: 44,
    });
  });

  it("logs a thrown rule as an error and carries on with the next", async () => {
    mockCompose
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ created: true, testRunId: 301, caseCount: 2 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb(analysis);

    await runAnalysisActions(db, 77, 3, {
      ...autoRun,
      actions: [{ actionId: "act-1" }, { actionId: "act-2" }],
    });

    expect(db.webhookActionLog.create.mock.calls[0][0].data).toMatchObject({
      webhookActionId: "act-1",
      outcome: "error",
      detail: "db down",
    });
    expect(db.webhookActionLog.create.mock.calls[1][0].data).toMatchObject({
      webhookActionId: "act-2",
      outcome: "run_created",
    });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:301", error: "run:error" },
    });
    spy.mockRestore();
  });
});
