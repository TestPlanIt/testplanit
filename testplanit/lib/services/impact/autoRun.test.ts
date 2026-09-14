import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRunFromAnalysis } from "./autoRun";

function makeDb(analysis: unknown, workflow: unknown = { id: 5 }) {
  return {
    impactAnalysis: {
      findUnique: vi.fn().mockResolvedValue(analysis),
      update: vi.fn().mockResolvedValue({}),
    },
    impactAnalysisCase: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workflows: { findFirst: vi.fn().mockResolvedValue(workflow) },
    testRuns: { create: vi.fn().mockResolvedValue({ id: 300 }) },
    webhookDelivery: { update: vi.fn().mockResolvedValue({}) },
  };
}
const autoRun = {
  trigger: "pull_request",
  label: "PR #12: Fix checkout",
  url: "https://github.com/acme/app/pull/12",
  deliveryId: "del-1",
};
const analysis = {
  id: 77,
  projectId: 3,
  testRunId: null,
  project: { createdBy: "owner-1" },
  cases: [{ caseId: 10 }, { caseId: 11 }, { caseId: 10 }],
};

describe("createRunFromAnalysis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("composes a run of the affected cases, links it, and marks the acceptance", async () => {
    const db = makeDb(analysis);

    const result = await createRunFromAnalysis(db, 77, autoRun);

    expect(result).toEqual({ created: true, testRunId: 300, caseCount: 2 });
    expect(db.impactAnalysis.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          cases: expect.objectContaining({
            where: { suggested: true, tier: { in: ["pinned", "affected"] } },
          }),
        }),
      })
    );
    expect(db.testRuns.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 3,
        name: "PR #12: Fix checkout",
        stateId: 5,
        createdById: "owner-1",
        testRunType: "REGULAR",
        testCases: {
          create: [
            { repositoryCase: { connect: { id: 10 } }, order: 0 },
            { repositoryCase: { connect: { id: 11 } }, order: 1 },
          ],
        },
      }),
      select: { id: true },
    });
    const note = db.testRuns.create.mock.calls[0][0].data.note;
    expect(JSON.stringify(note)).toContain(
      "https://github.com/acme/app/pull/12"
    );
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { testRunId: 300 },
    });
    expect(db.impactAnalysisCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { analysisId: 77, suggested: true, caseId: { in: [10, 11] } },
        data: expect.objectContaining({
          accepted: true,
          reviewedById: "owner-1",
        }),
      })
    );
    expect(db.webhookDelivery.update).toHaveBeenLastCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "run:300", error: null },
    });
  });

  it("makes no run when the analysis found no affected cases, and says so on the delivery", async () => {
    const db = makeDb({ ...analysis, cases: [] });

    const result = await createRunFromAnalysis(db, 77, autoRun);

    expect(result).toEqual({ created: false, reason: "no_cases" });
    expect(db.testRuns.create).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { subjectRef: "analysis:77", error: "run:no_affected_cases" },
    });
  });

  it("does not compose a second run for an analysis already linked to one", async () => {
    const db = makeDb({ ...analysis, testRunId: 44 });

    expect(await createRunFromAnalysis(db, 77, autoRun)).toEqual({
      created: false,
      reason: "already_linked",
    });
    expect(db.testRuns.create).not.toHaveBeenCalled();
  });

  it("falls back to any enabled run workflow and gives up without one", async () => {
    const db = makeDb(analysis, null);
    db.workflows.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 8 });
    expect(await createRunFromAnalysis(db, 77, autoRun)).toMatchObject({
      created: true,
    });
    expect(db.testRuns.create.mock.calls[0][0].data.stateId).toBe(8);

    const none = makeDb(analysis, null);
    expect(await createRunFromAnalysis(none, 77, autoRun)).toEqual({
      created: false,
      reason: "no_workflow",
    });
  });

  it("truncates a long label into the run name", async () => {
    const db = makeDb(analysis);
    await createRunFromAnalysis(db, 77, { ...autoRun, label: "x".repeat(400) });
    expect(db.testRuns.create.mock.calls[0][0].data.name).toHaveLength(200);
  });
});
