import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getEnhancedDb: vi.fn(),
  findFirst: vi.fn(),
  isProjectAdminFor: vi.fn(),
  userHasAreaPermission: vi.fn(),
  getInstance: vi.fn(),
  resolveIntegration: vi.fn(),
  getFailureTriageQueue: vi.fn(),
  enqueueSignatureClassification: vi.fn(),
  getCurrentTenantId: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: mocks.getEnhancedDb }));
vi.mock("~/lib/db", () => ({ baseDb: {} }));
vi.mock("~/lib/llm/services/llm-manager.service", () => ({
  LlmManager: { getInstance: mocks.getInstance },
}));
vi.mock("~/lib/services/areaPermission", () => ({
  isProjectAdminFor: mocks.isProjectAdminFor,
  userHasAreaPermission: mocks.userHasAreaPermission,
}));
vi.mock("~/lib/services/triage/enqueue", () => ({
  enqueueSignatureClassification: mocks.enqueueSignatureClassification,
}));
vi.mock("~/lib/queues", () => ({
  getFailureTriageQueue: mocks.getFailureTriageQueue,
}));
vi.mock("@/lib/multiTenantDb", () => ({
  getCurrentTenantId: mocks.getCurrentTenantId,
}));

import { baseDb } from "~/lib/db";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { authOptions } from "~/server/auth";

import { POST } from "./route";

const session = { user: { id: "user-1", access: "USER" } };

function makeRequest(): NextRequest {
  return new NextRequest(
    "http://localhost/api/projects/5/triage/signatures/42/classify",
    { method: "POST" }
  );
}

const params = (projectId = "5", signatureId = "42") => ({
  params: Promise.resolve({ projectId, signatureId }),
});

/** Area grants the user holds on the project, as [area, permission] pairs. */
function grant(...grants: Array<[string, string]>) {
  mocks.userHasAreaPermission.mockImplementation(
    async (
      _userId: string,
      _projectId: number,
      area: string,
      permission: string
    ) => grants.some(([a, p]) => a === area && p === permission)
  );
}

const expectedJob = {
  projectId: 5,
  signatureIds: [42],
  userId: "user-1",
  tenantId: "tenant-a",
};

describe("POST /api/projects/[projectId]/triage/signatures/[signatureId]/classify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(session);
    mocks.getEnhancedDb.mockResolvedValue({
      failureSignature: { findFirst: mocks.findFirst },
    });
    mocks.findFirst.mockResolvedValue({
      id: 42,
      project: { failureTriageEnabled: true },
    });
    mocks.isProjectAdminFor.mockResolvedValue(true);
    grant();
    mocks.getInstance.mockReturnValue({
      resolveIntegration: mocks.resolveIntegration,
    });
    mocks.resolveIntegration.mockResolvedValue({ integrationId: 3 });
    mocks.getFailureTriageQueue.mockReturnValue({ add: vi.fn() });
    mocks.enqueueSignatureClassification.mockResolvedValue(undefined);
    mocks.getCurrentTenantId.mockReturnValue("tenant-a");
  });

  it("401s without a signed-in user", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });

    mocks.getServerSession.mockResolvedValue({ user: {} });
    expect((await POST(makeRequest(), params())).status).toBe(401);

    expect(mocks.getServerSession).toHaveBeenCalledWith(authOptions);
    expect(mocks.getEnhancedDb).not.toHaveBeenCalled();
    expect(mocks.enqueueSignatureClassification).not.toHaveBeenCalled();
  });

  it.each([
    ["abc", "42"],
    ["5", "x"],
    ["5", "4.2"],
  ])(
    "400s project id %j with signature id %j",
    async (projectId, signatureId) => {
      const res = await POST(makeRequest(), params(projectId, signatureId));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid id" });
      expect(mocks.getEnhancedDb).not.toHaveBeenCalled();
      expect(mocks.enqueueSignatureClassification).not.toHaveBeenCalled();
    }
  );

  it("404s a signature that is missing from this project or hidden from the session", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Signature not found" });
    expect(mocks.getEnhancedDb).toHaveBeenCalledWith(session);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: 42, projectId: 5 },
      select: { id: true, project: { select: { failureTriageEnabled: true } } },
    });
    expect(mocks.isProjectAdminFor).not.toHaveBeenCalled();
    expect(mocks.userHasAreaPermission).not.toHaveBeenCalled();
    expect(mocks.enqueueSignatureClassification).not.toHaveBeenCalled();
  });

  it("403s a user who is neither project admin nor a Failure Patterns editor", async () => {
    mocks.isProjectAdminFor.mockResolvedValue(false);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mocks.isProjectAdminFor).toHaveBeenCalledWith("user-1", 5);
    expect(mocks.userHasAreaPermission).toHaveBeenCalledWith(
      "user-1",
      5,
      "FailurePatterns",
      "canAddEdit"
    );
    expect(mocks.resolveIntegration).not.toHaveBeenCalled();
    expect(mocks.enqueueSignatureClassification).not.toHaveBeenCalled();
  });

  it("403s add/edit on other areas and delete-only on Failure Patterns", async () => {
    mocks.isProjectAdminFor.mockResolvedValue(false);
    grant(
      ["TestRuns", "canAddEdit"],
      ["TestCaseRepository", "canAddEdit"],
      ["FailurePatterns", "canDelete"]
    );

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(mocks.enqueueSignatureClassification).not.toHaveBeenCalled();
  });

  it("queues the classification for a project admin with no Failure Patterns grant", async () => {
    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true });
    expect(mocks.isProjectAdminFor).toHaveBeenCalledWith("user-1", 5);
    expect(mocks.enqueueSignatureClassification).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueSignatureClassification).toHaveBeenCalledWith(
      expectedJob
    );
  });

  it("queues the classification for a Failure Patterns editor who is not a project admin", async () => {
    mocks.isProjectAdminFor.mockResolvedValue(false);
    grant(["FailurePatterns", "canAddEdit"]);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true });
    expect(mocks.userHasAreaPermission).toHaveBeenCalledWith(
      "user-1",
      5,
      "FailurePatterns",
      "canAddEdit"
    );
    expect(mocks.enqueueSignatureClassification).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueSignatureClassification).toHaveBeenCalledWith(
      expectedJob
    );
  });

  it("400s when failure triage is disabled for the project", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 42,
      project: { failureTriageEnabled: false },
    });

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Failure triage is disabled for this project",
    });
    expect(mocks.resolveIntegration).not.toHaveBeenCalled();
    expect(mocks.enqueueSignatureClassification).not.toHaveBeenCalled();
  });

  it("409s when no AI model resolves for failure triage on the project", async () => {
    mocks.resolveIntegration.mockResolvedValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "No AI model is configured for failure triage",
    });
    expect(mocks.getInstance.mock.calls[0][0]).toBe(baseDb);
    expect(mocks.resolveIntegration).toHaveBeenCalledWith(
      LLM_FEATURES.FAILURE_TRIAGE,
      5
    );
    expect(mocks.enqueueSignatureClassification).not.toHaveBeenCalled();
  });

  it("503s when the failure triage queue is unavailable", async () => {
    mocks.getFailureTriageQueue.mockReturnValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Background job queue is not available",
    });
    expect(mocks.enqueueSignatureClassification).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the signature lookup",
      () => mocks.findFirst.mockRejectedValue(new Error("db down")),
    ],
    [
      "enqueueing",
      () =>
        mocks.enqueueSignatureClassification.mockRejectedValue(
          new Error("valkey down")
        ),
    ],
  ])("500s with a generic body when %s throws", async (_label, arrange) => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    arrange();

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to request classification",
    });
    consoleError.mockRestore();
  });
});
