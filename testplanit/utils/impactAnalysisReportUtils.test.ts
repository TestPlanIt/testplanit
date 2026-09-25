import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany, mockAuthorize } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockAuthorize: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  baseDb: {
    impactAnalysis: { findMany: (...a: unknown[]) => mockFindMany(...a) },
  },
}));
vi.mock("~/utils/reportApiUtils", () => ({
  authorizeReportRequest: (...a: unknown[]) => mockAuthorize(...a),
}));

import {
  classifyRunOutcome,
  handleImpactAnalysisReportPOST,
  toReportRow,
  triggerOf,
} from "./impactAnalysisReportUtils";

const status = (s: boolean, f: boolean, c = true) => ({
  status: { isSuccess: s, isFailure: f, isCompleted: c },
});

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    createdAt: new Date("2026-09-10T10:00:00Z"),
    completedAt: new Date("2026-09-10T10:01:30Z"),
    status: "COMPLETED",
    trigger: "pull_request",
    triggerLabel: "PR #12: Fix checkout",
    triggerUrl: "https://github.com/acme/app/pull/12",
    baseRef: "main",
    headRef: null,
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    fileCount: 4,
    additions: 30,
    deletions: 5,
    pinnedCaseCount: 2,
    affectedCaseCount: 3,
    config: {
      id: 9,
      branch: "main",
      repository: { id: 3, name: "acme/app", provider: "GITHUB" },
    },
    cases: [
      { tier: "pinned", accepted: true },
      { tier: "affected", accepted: true },
      { tier: "affected", accepted: false },
      { tier: "related", accepted: null },
    ],
    testRun: {
      id: 300,
      name: "PR #12: Fix checkout",
      testCases: [status(true, false), status(false, true), { status: null }],
    },
    createdBy: { id: "u1", name: "Brad" },
    project: { id: 42, name: "Web" },
    ...overrides,
  };
}

function post(body: Record<string, unknown>) {
  return new NextRequest(
    "http://localhost/api/report-builder/impact-analysis",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("impact analysis report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorize.mockResolvedValue({ ok: true, bypass: false });
    mockFindMany.mockResolvedValue([analysis()]);
  });

  it("classifies run outcomes from status flags", () => {
    expect(classifyRunOutcome({ hasRun: false, executed: 0, failed: 0 })).toBe(
      "no_run"
    );
    expect(classifyRunOutcome({ hasRun: true, executed: 0, failed: 0 })).toBe(
      "not_executed"
    );
    expect(classifyRunOutcome({ hasRun: true, executed: 3, failed: 1 })).toBe(
      "failed"
    );
    expect(classifyRunOutcome({ hasRun: true, executed: 3, failed: 0 })).toBe(
      "passed"
    );
    expect(triggerOf(null)).toBe("manual");
    expect(triggerOf("push")).toBe("push");
  });

  it("shapes a row with counts, refs, duration and the composed run's outcome", () => {
    const row = toReportRow(analysis() as any, false);
    expect(row).toMatchObject({
      analysisId: 7,
      durationMs: 90_000,
      repository: {
        configId: 9,
        name: "acme/app",
        provider: "GITHUB",
        branch: "main",
      },
      trigger: "pull_request",
      baseRef: "main",
      headRef: "bbbbbbb",
      relatedCaseCount: 1,
      acceptedCaseCount: 2,
      testRun: { id: 300, name: "PR #12: Fix checkout" },
      runCaseCount: 3,
      runExecutedCount: 2,
      runPassedCount: 1,
      runFailedCount: 1,
      outcome: "failed",
    });
    expect(row.project).toBeUndefined();
    expect(toReportRow(analysis() as any, true).project).toEqual({
      id: 42,
      name: "Web",
    });
  });

  it("requires a project id for the project report and returns rows", async () => {
    const missing = await handleImpactAnalysisReportPOST(post({}), false);
    expect(missing.status).toBe(400);

    const res = await handleImpactAnalysisReportPOST(
      post({
        projectId: 42,
        lookbackDays: 30,
        triggerFilter: "pull_request",
        configId: 9,
      }),
      false
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.lookbackDays).toBe(30);
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      isDeleted: false,
      projectId: 42,
      configId: { in: [9] },
      OR: [{ trigger: { in: ["pull_request"] } }],
    });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("accepts several triggers, outcomes and repositories at once", async () => {
    mockFindMany.mockResolvedValue([
      analysis({ id: 1, trigger: null }),
      analysis({ id: 2, trigger: null, testRun: null }),
    ]);
    const res = await handleImpactAnalysisReportPOST(
      post({
        projectId: 42,
        lookbackDays: 0,
        triggerFilter: ["manual", "push", "cron"],
        outcomeFilter: ["no_run", "passed"],
        configId: [9, 4],
      }),
      false
    );
    const body = await res.json();
    expect(mockFindMany.mock.calls[0][0].where).toMatchObject({
      configId: { in: [9, 4] },
      OR: [{ trigger: null }, { trigger: { in: ["push"] } }],
    });
    expect(body.data.map((r: any) => r.analysisId)).toEqual([2]);
  });

  it("maps the manual trigger filter to analyses without a trigger and filters by outcome after shaping", async () => {
    mockFindMany.mockResolvedValue([
      analysis({ id: 1, trigger: null }),
      analysis({ id: 2, trigger: null, testRun: null }),
    ]);
    const res = await handleImpactAnalysisReportPOST(
      post({
        projectId: 42,
        lookbackDays: 0,
        triggerFilter: "manual",
        outcomeFilter: "no_run",
      }),
      false
    );
    const body = await res.json();
    expect(mockFindMany.mock.calls[0][0].where).toMatchObject({
      OR: [{ trigger: null }],
    });
    expect(mockFindMany.mock.calls[0][0].where.createdAt).toBeUndefined();
    expect(body.data.map((r: any) => r.analysisId)).toEqual([2]);
  });

  it("scopes the cross-project report to projects with Impact enabled and adds the project column on request", async () => {
    const res = await handleImpactAnalysisReportPOST(
      post({ dimensions: ["project"] }),
      true
    );
    const body = await res.json();
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), {
      requiresAdmin: true,
      projectId: undefined,
    });
    expect(mockFindMany.mock.calls[0][0].where).toMatchObject({
      project: { isDeleted: false, impactEnabled: true },
    });
    expect(body.data[0].project).toEqual({ id: 42, name: "Web" });
  });

  it("passes through an authorization refusal", async () => {
    mockAuthorize.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await handleImpactAnalysisReportPOST(
      post({ projectId: 42 }),
      false
    );
    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
