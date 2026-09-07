import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: (...args: any[]) => any) => handler,
}));

vi.mock("~/lib/auditContext", () => ({
  updateAuditContext: vi.fn(),
}));

vi.mock("~/lib/utils/errors", () => ({
  isAccessPolicyError: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { updateAuditContext } from "~/lib/auditContext";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { PATCH } from "./route";

const session = { user: { id: "user-1" } };

function makeDb() {
  return {
    impactAnalysis: {
      findFirst: vi.fn().mockResolvedValue({ id: 77 }),
      update: vi.fn().mockResolvedValue({ id: 77 }),
    },
    testRuns: {
      findFirst: vi.fn().mockResolvedValue({ id: 500 }),
    },
    impactAnalysisCase: {
      updateMany: vi
        .fn()
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 3 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

function makeRequest(body: unknown) {
  return new NextRequest(
    "http://localhost/api/projects/3/impact/analyses/77/cases",
    {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

function makeParams(projectId = "3", analysisId = "77") {
  return { params: Promise.resolve({ projectId, analysisId }) };
}

describe("PATCH /api/projects/[projectId]/impact/analyses/[analysisId]/cases", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    (getServerSession as any).mockResolvedValue(session);
    (getEnhancedDb as any).mockResolvedValue(db);
    (isAccessPolicyError as any).mockReturnValue(false);
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await PATCH(
      makeRequest({ acceptedCaseIds: [1] }),
      makeParams()
    );

    expect(res.status).toBe(401);
    expect(updateAuditContext).not.toHaveBeenCalled();
  });

  it("returns 400 when either id is not an integer", async () => {
    expect(
      (
        await PATCH(
          makeRequest({ acceptedCaseIds: [1] }),
          makeParams("x", "77")
        )
      ).status
    ).toBe(400);
    expect(
      (
        await PATCH(
          makeRequest({ acceptedCaseIds: [1] }),
          makeParams("3", "7.7")
        )
      ).status
    ).toBe(400);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await PATCH(makeRequest("{oops"), makeParams());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request body" });
  });

  it("returns 400 when acceptedCaseIds is missing or invalid", async () => {
    expect((await PATCH(makeRequest({}), makeParams())).status).toBe(400);
    expect(
      (await PATCH(makeRequest({ acceptedCaseIds: [0] }), makeParams())).status
    ).toBe(400);
    expect(
      (
        await PATCH(
          makeRequest({ acceptedCaseIds: [1], testRunId: -1 }),
          makeParams()
        )
      ).status
    ).toBe(400);
    expect(getEnhancedDb).not.toHaveBeenCalled();
  });

  it("returns 404 when the analysis is not in the project", async () => {
    db.impactAnalysis.findFirst.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest({ acceptedCaseIds: [1] }),
      makeParams()
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Analysis not found" });
    expect(db.impactAnalysis.findFirst).toHaveBeenCalledWith({
      where: { id: 77, projectId: 3, isDeleted: false },
      select: { id: true },
    });
    expect(db.impactAnalysisCase.updateMany).not.toHaveBeenCalled();
  });

  it("records accepted and rejected suggestions with the reviewer stamp", async () => {
    const before = Date.now();

    const res = await PATCH(
      makeRequest({ acceptedCaseIds: [1, 2] }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accepted: 2,
      rejected: 3,
      added: 0,
      testRunId: null,
    });
    expect(updateAuditContext).toHaveBeenCalledWith({ userId: "user-1" });

    expect(db.impactAnalysisCase.updateMany).toHaveBeenCalledTimes(2);
    const [acceptedCall, rejectedCall] =
      db.impactAnalysisCase.updateMany.mock.calls;

    expect(acceptedCall[0].where).toEqual({
      analysisId: 77,
      suggested: true,
      caseId: { in: [1, 2] },
    });
    expect(acceptedCall[0].data).toMatchObject({
      accepted: true,
      reviewedById: "user-1",
    });
    expect(acceptedCall[0].data.reviewedAt).toBeInstanceOf(Date);
    expect(acceptedCall[0].data.reviewedAt.getTime()).toBeGreaterThanOrEqual(
      before
    );

    expect(rejectedCall[0].where).toEqual({
      analysisId: 77,
      suggested: true,
      caseId: { notIn: [1, 2] },
    });
    expect(rejectedCall[0].data).toMatchObject({
      accepted: false,
      reviewedById: "user-1",
    });
    // Both updates share the same review timestamp.
    expect(rejectedCall[0].data.reviewedAt).toEqual(
      acceptedCall[0].data.reviewedAt
    );

    expect(db.impactAnalysisCase.upsert).not.toHaveBeenCalled();
    expect(db.impactAnalysis.update).not.toHaveBeenCalled();
  });

  it("rejects every suggestion when nothing was accepted", async () => {
    const res = await PATCH(makeRequest({ acceptedCaseIds: [] }), makeParams());

    expect(res.status).toBe(200);
    const [acceptedCall, rejectedCall] =
      db.impactAnalysisCase.updateMany.mock.calls;
    expect(acceptedCall[0].where.caseId).toEqual({ in: [] });
    expect(rejectedCall[0].where.caseId).toEqual({ notIn: [] });
  });

  it("upserts manual adds as addedManually, skipping ids that were also accepted", async () => {
    const res = await PATCH(
      makeRequest({ acceptedCaseIds: [1, 2], addedCaseIds: [2, 9, 10] }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect((await res.json()).added).toBe(2);

    expect(db.impactAnalysisCase.upsert).toHaveBeenCalledTimes(2);
    const upserted = db.impactAnalysisCase.upsert.mock.calls.map(
      (c: any[]) => c[0]
    );
    expect(upserted.map((u) => u.where)).toEqual([
      { analysisId_caseId: { analysisId: 77, caseId: 9 } },
      { analysisId_caseId: { analysisId: 77, caseId: 10 } },
    ]);
    expect(upserted[0].create).toMatchObject({
      analysisId: 77,
      caseId: 9,
      score: 0,
      tier: "related",
      layers: [],
      reasons: [],
      coveredFiles: [],
      suggested: false,
      addedManually: true,
      accepted: true,
      reviewedById: "user-1",
    });
    expect(upserted[0].create.reviewedAt).toBeInstanceOf(Date);
    expect(upserted[0].update).toMatchObject({
      addedManually: true,
      accepted: true,
      reviewedById: "user-1",
    });
    // An accepted suggestion is never re-flagged as a manual add.
    expect(upserted.some((u) => u.where.analysisId_caseId.caseId === 2)).toBe(
      false
    );
  });

  it("returns 404 when testRunId is not a live run in the project, without touching cases", async () => {
    db.testRuns.findFirst.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest({ acceptedCaseIds: [1], testRunId: 500 }),
      makeParams()
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Run not found" });
    expect(db.testRuns.findFirst).toHaveBeenCalledWith({
      where: { id: 500, projectId: 3, isDeleted: false },
      select: { id: true },
    });
    expect(db.impactAnalysisCase.updateMany).not.toHaveBeenCalled();
    expect(db.impactAnalysis.update).not.toHaveBeenCalled();
  });

  it("stores a validated testRunId on the analysis and echoes it", async () => {
    const res = await PATCH(
      makeRequest({ acceptedCaseIds: [1], testRunId: 500 }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect((await res.json()).testRunId).toBe(500);
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { testRunId: 500 },
    });
  });

  it("does not look up or store a run when testRunId is omitted", async () => {
    await PATCH(makeRequest({ acceptedCaseIds: [1] }), makeParams());

    expect(db.testRuns.findFirst).not.toHaveBeenCalled();
    expect(db.impactAnalysis.update).not.toHaveBeenCalled();
  });

  it("returns 403 when a write is rejected by policy", async () => {
    db.impactAnalysisCase.updateMany.mockReset();
    db.impactAnalysisCase.updateMany.mockRejectedValue(new Error("denied"));
    (isAccessPolicyError as any).mockReturnValue(true);

    const res = await PATCH(
      makeRequest({ acceptedCaseIds: [1] }),
      makeParams()
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 500 for any other failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.impactAnalysis.findFirst.mockRejectedValue(new Error("db down"));

    const res = await PATCH(
      makeRequest({ acceptedCaseIds: [1] }),
      makeParams()
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to record review" });
  });
});
