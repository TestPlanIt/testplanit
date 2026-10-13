import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the route handler.
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: any) => handler,
}));

const { mockTxUpdate, mockAuditedTransaction } = vi.hoisted(() => ({
  mockTxUpdate: vi.fn(),
  mockAuditedTransaction: vi.fn(),
}));

vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: mockAuditedTransaction,
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    projectIntegration: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

vi.mock("~/lib/services/requirementHierarchy", () => ({
  recomputeRequirementClassification: vi.fn(),
}));

import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { recomputeRequirementClassification } from "~/lib/services/requirementHierarchy";

import { PUT } from "./route";

const params = { params: Promise.resolve({ id: "4" }) };

const createRequest = (payload: unknown): NextRequest =>
  new NextRequest("http://localhost/api/integrations/4/requirements-config", {
    method: "PUT",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });

describe("requirements-config route", () => {
  // The transaction client the mocked auditedTransaction hands the route's
  // callback — asserting against THIS object is what lets the atomicity
  // test prove both writes happened inside the same callback invocation.
  const mockTx = { projectIntegration: { update: mockTxUpdate } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditedTransaction.mockImplementation(async (fn: any) => fn(mockTx));
    (getServerSession as any).mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    (authorizeProjectAdminForProject as any).mockResolvedValue({
      ok: true,
      status: 200,
      projectId: 42,
    });
    (baseDb.projectIntegration.findFirst as any).mockResolvedValue({
      id: "pi-1",
      config: { milestoneSync: { enabled: true, kinds: ["RELEASE"] } },
    });
    (recomputeRequirementClassification as any).mockResolvedValue({
      classified: 3,
      declassified: 1,
    });
  });

  it("rejects an unauthenticated caller with 401", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await PUT(
      createRequest({
        projectId: 42,
        enabled: true,
        issueTypeIds: ["10001"],
      }),
      params
    );

    expect(res.status).toBe(401);
    expect(baseDb.projectIntegration.findFirst).not.toHaveBeenCalled();
    expect(mockAuditedTransaction).not.toHaveBeenCalled();
  });

  it("rejects a caller who is not a project admin with 403", async () => {
    (authorizeProjectAdminForProject as any).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await PUT(
      createRequest({
        projectId: 42,
        enabled: true,
        issueTypeIds: ["10001"],
      }),
      params
    );

    expect(res.status).toBe(403);
    expect(baseDb.projectIntegration.findFirst).not.toHaveBeenCalled();
    expect(mockAuditedTransaction).not.toHaveBeenCalled();
  });

  it("rejects a projectId that does not own the addressed integration with 404", async () => {
    (baseDb.projectIntegration.findFirst as any).mockResolvedValue(null);

    const res = await PUT(
      createRequest({
        projectId: 42,
        enabled: true,
        issueTypeIds: ["10001"],
      }),
      params
    );

    expect(res.status).toBe(404);
    expect(baseDb.projectIntegration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 42, integrationId: 4, isActive: true },
      })
    );
    expect(mockAuditedTransaction).not.toHaveBeenCalled();
  });

  it("rejects a malformed issueTypeIds payload with 400", async () => {
    const res = await PUT(
      createRequest({
        projectId: 42,
        enabled: true,
        issueTypeIds: "10001",
      }),
      params
    );

    expect(res.status).toBe(400);
    // 400 fires before the admin gate and before any read — an invalid
    // payload shape is rejected without leaking whether the caller is even
    // a project admin.
    expect(authorizeProjectAdminForProject).not.toHaveBeenCalled();
    expect(baseDb.projectIntegration.findFirst).not.toHaveBeenCalled();
    expect(mockAuditedTransaction).not.toHaveBeenCalled();
  });

  it("writes the config and the classification recompute inside one audited transaction", async () => {
    const res = await PUT(
      createRequest({
        projectId: 42,
        enabled: true,
        issueTypeIds: ["10001", "10002"],
      }),
      params
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ classified: 3, declassified: 1 });

    expect(mockAuditedTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "pi-1" } })
    );
    expect(recomputeRequirementClassification).toHaveBeenCalledTimes(1);
    expect(recomputeRequirementClassification).toHaveBeenCalledWith(
      42,
      ["10001", "10002"],
      [],
      // nextEffectiveTypeIds must be the FULL post-save effective list —
      // the label-mode declassify keeps a multi-label row classified only
      // when the route hands it what remains configured.
      { tx: mockTx, nextEffectiveTypeIds: ["10001", "10002"] }
    );
  });

  it("preserves the milestoneSync namespace on the shared config column", async () => {
    (baseDb.projectIntegration.findFirst as any).mockResolvedValue({
      id: "pi-1",
      config: {
        milestoneSync: { enabled: true, kinds: ["RELEASE", "ITERATION"] },
      },
    });

    await PUT(
      createRequest({
        projectId: 42,
        enabled: true,
        issueTypeIds: ["10001"],
      }),
      params
    );

    const call = mockTxUpdate.mock.calls[0][0];
    expect(call.data.config.milestoneSync).toEqual({
      enabled: true,
      kinds: ["RELEASE", "ITERATION"],
    });
  });
});
