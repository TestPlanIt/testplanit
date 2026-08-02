/**
 * Pre-stream gate tests for POST /api/reports/automation-candidates.
 *
 * Stops at the point where the route would start streaming the LLM
 * response — driving the actual streaming body through vitest pulls in
 * far more LLM-manager surface than is worth covering here, and the
 * progressive-parse side is already directly tested in
 * `streamingParser.test.ts`. These tests pin down the synchronous gates
 * that decide whether a snapshot row is ever created.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internalReportBypassToken } from "~/lib/internalReportBypass";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    projectLlmIntegration: { findFirst: vi.fn() },
    projects: { findUnique: vi.fn() },
    repositoryCases: { findMany: vi.fn() },
    testRunCases: { groupBy: vi.fn().mockResolvedValue([]) },
    llmReportSnapshot: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: vi.fn() }));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { POST } from "./route";

function reqWithBody(
  body: unknown,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/reports/automation-candidates", {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    })
  );
}

const findLlm = baseDb.projectLlmIntegration.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const findProject = baseDb.projects.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const findCases = baseDb.repositoryCases.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const findSnapshot = baseDb.llmReportSnapshot
  .findFirst as unknown as ReturnType<typeof vi.fn>;

describe("POST /api/reports/automation-candidates (pre-stream gates)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401s when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(reqWithBody({ projectId: 7 }));
    expect(res.status).toBe(401);
  });

  it("400s on an invalid body", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    const res = await POST(reqWithBody({ wrongKey: true }));
    expect(res.status).toBe(400);
  });

  it("falls through to the heuristic path (not 400) when no LLM is configured", async () => {
    // Heuristic-mode: no LLM call, no 400. The route resolves the project
    // and starts streaming the synthesized heuristic ranking. We stop
    // short of running the stream here — see the dedicated heuristic
    // tests in automationCandidatesHeuristic.test.ts for the ranking
    // shape. A 404 (project not found) is the next gate after the LLM
    // check and confirms we passed the LLM gate.
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findLlm.mockResolvedValue(null);
    findProject.mockResolvedValue(null);
    const res = await POST(reqWithBody({ projectId: 7 }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("project_not_found");
  });

  it("404s when the project does not exist", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findLlm.mockResolvedValue({
      llmIntegrationId: 1,
      llmIntegration: { status: "ACTIVE", llmProviderConfig: null },
    });
    findProject.mockResolvedValue(null);
    const res = await POST(reqWithBody({ projectId: 999 }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("project_not_found");
  });

  it("400s with code no_manual_cases when every case is already automated", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findLlm.mockResolvedValue({
      llmIntegrationId: 1,
      llmIntegration: { status: "ACTIVE", llmProviderConfig: null },
    });
    findProject.mockResolvedValue({ id: 7, name: "Demo" });
    findCases.mockResolvedValue([]);
    const res = await POST(reqWithBody({ projectId: 7 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("no_manual_cases");
  });

  it("403s when the user does not have Reporting.canAddEdit (ZenStack create denial)", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findLlm.mockResolvedValue({
      llmIntegrationId: 1,
      llmIntegration: { status: "ACTIVE", llmProviderConfig: null },
    });
    findProject.mockResolvedValue({ id: 7, name: "Demo" });
    findCases.mockResolvedValue([
      {
        id: 100,
        name: "A",
        className: null,
        source: "MANUAL",
        automated: false,
        hasParameters: false,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        steps: [{ id: 1 }],
        caseFieldValues: [],
        caseIssues: [],
        _count: { testRuns: 0 },
      },
    ]);
    vi.mocked(getEnhancedDb).mockResolvedValue({
      llmReportSnapshot: {
        create: vi.fn().mockRejectedValue(new Error("policy denied")),
      },
    } as never);
    const res = await POST(reqWithBody({ projectId: 7 }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("forbidden");
  });
});

describe("POST /api/reports/automation-candidates (shared-report bypass)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips session check when the x-shared-report-bypass header is set", async () => {
    // No session — should still respond because the bypass header is
    // present. (Anonymous public shares hit this path.)
    vi.mocked(getServerSession).mockResolvedValue(null);
    findSnapshot.mockResolvedValue({
      id: 99,
      status: "complete",
      output: {
        candidates: [],
        summary: "",
        selectionStrategy: "most_executed",
      },
      generatedBy: { id: "u1", name: "Alice", email: "a@example.com" },
    });
    const res = await POST(
      reqWithBody(
        { projectId: 7 },
        { "x-shared-report-bypass": internalReportBypassToken() }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot?.id).toBe(99);
  });

  it("returns snapshot: null when the project has no completed snapshots yet", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    findSnapshot.mockResolvedValue(null);
    const res = await POST(
      reqWithBody(
        { projectId: 7 },
        { "x-shared-report-bypass": internalReportBypassToken() }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot).toBeNull();
  });

  it("400s when bypass is set but the body has no projectId (defends against config drift)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(
      reqWithBody(
        { somethingElse: 1 },
        { "x-shared-report-bypass": internalReportBypassToken() }
      )
    );
    expect(res.status).toBe(400);
    expect(findSnapshot).not.toHaveBeenCalled();
  });

  it("falls back to the latest COMPLETE snapshot when no snapshotId is captured (older shares)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    findSnapshot.mockResolvedValue(null);
    await POST(
      reqWithBody(
        { projectId: 7 },
        { "x-shared-report-bypass": internalReportBypassToken() }
      )
    );
    const args = findSnapshot.mock.calls[0]![0];
    expect(args.where).toMatchObject({
      projectId: 7,
      reportType: "automation_candidates",
      status: "complete",
      isDeleted: false,
    });
    expect(args.where.id).toBeUndefined();
    expect(args.orderBy).toEqual({ completedAt: "desc" });
  });

  it("resolves a specific captured snapshotId (so a share keeps showing the same ranking after a regeneration)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    findSnapshot.mockResolvedValue({
      id: 42,
      status: "complete",
      output: { selectionStrategy: "most_executed" },
      generatedBy: { id: "u1", name: "B", email: "b@example.com" },
    });
    const res = await POST(
      reqWithBody(
        { projectId: 7, snapshotId: 42 },
        { "x-shared-report-bypass": internalReportBypassToken() }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot?.id).toBe(42);
    // Query targets the captured id and skips the "latest" orderBy.
    const args = findSnapshot.mock.calls[0]![0];
    expect(args.where).toMatchObject({
      id: 42,
      projectId: 7,
      reportType: "automation_candidates",
      status: "complete",
      isDeleted: false,
    });
    expect(args.orderBy).toBeUndefined();
  });

  it("returns snapshot: null when the captured snapshotId has since been deleted (graceful degrade)", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    findSnapshot.mockResolvedValue(null);
    const res = await POST(
      reqWithBody(
        { projectId: 7, snapshotId: 9999 },
        { "x-shared-report-bypass": internalReportBypassToken() }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot).toBeNull();
  });
});
