import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/api-token-auth", () => ({ authenticateRequest: vi.fn() }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findUnique: vi.fn() },
    testRunResults: { findFirst: vi.fn() },
  },
}));

const { txMock } = vi.hoisted(() => ({
  txMock: {
    testRunResults: { update: vi.fn(), findFirst: vi.fn() },
    testRunCases: { update: vi.fn(), findUnique: vi.fn() },
    testRunCaseIteration: { update: vi.fn(), findMany: vi.fn() },
    status: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
    fn(txMock)
  ),
}));

import { getServerSession } from "next-auth";
import { authenticateRequest } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";

/**
 * Deleting a result used to go straight through the model API, flipping
 * `isDeleted` and nothing else — so the run kept reporting the outcome of a
 * result that was no longer in the history.
 */
describe("Delete Result API Route", () => {
  const createRequest = (body: unknown) =>
    new NextRequest("http://localhost/api/test-runs/delete-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const baseExisting = {
    id: 468927,
    testRunCaseId: 850743,
    iterationId: null as number | null,
    testRunCase: {
      assignedToId: "user-1",
      testRun: {
        name: "ABT-38594",
        createdById: "user-1",
        projectId: 2,
        isCompleted: false,
        project: {
          createdBy: "user-1",
          defaultAccessType: "GLOBAL_ROLE",
          assignedUsers: [],
          userPermissions: [],
          groupPermissions: [],
          defaultRole: null,
        },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(authenticateRequest).mockResolvedValue({
      authenticated: true,
      user: { userId: "user-1" },
    } as never);
    vi.mocked(baseDb.user.findUnique).mockResolvedValue({
      id: "user-1",
      access: "USER",
      role: { rolePermissions: [{ canAddEdit: true }] },
    } as never);
    txMock.testRunResults.update.mockResolvedValue({ id: 468927 });
    txMock.testRunCases.findUnique.mockResolvedValue({
      testRun: { testRunType: "REGULAR" },
    });
  });

  it("soft-deletes the result and falls the case back to the surviving result", async () => {
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue(
      baseExisting as never
    );
    txMock.testRunResults.findFirst.mockResolvedValue({ statusId: 3 });

    const res = await POST(createRequest({ resultId: 468927 }));

    expect(res.status).toBe(200);
    expect(txMock.testRunResults.update).toHaveBeenCalledWith({
      where: { id: 468927 },
      data: { isDeleted: true },
    });
    expect(txMock.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 850743 },
      data: { statusId: 3 },
    });
  });

  it("clears the case to untested when the last result is removed", async () => {
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue(
      baseExisting as never
    );
    txMock.testRunResults.findFirst.mockResolvedValue(null);

    const res = await POST(createRequest({ resultId: 468927 }));

    expect(res.status).toBe(200);
    expect(txMock.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 850743 },
      data: { statusId: null },
    });
  });

  it("rejects a delete on a completed run without writing", async () => {
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue({
      ...baseExisting,
      testRunCase: {
        ...baseExisting.testRunCase,
        testRun: { ...baseExisting.testRunCase.testRun, isCompleted: true },
      },
    } as never);

    const res = await POST(createRequest({ resultId: 468927 }));

    expect(res.status).toBe(409);
    expect(txMock.testRunResults.update).not.toHaveBeenCalled();
  });

  it("rejects a caller without result permissions", async () => {
    vi.mocked(baseDb.user.findUnique).mockResolvedValue({
      id: "user-2",
      access: "USER",
      role: { rolePermissions: [] },
    } as never);
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue({
      ...baseExisting,
      testRunCase: {
        ...baseExisting.testRunCase,
        assignedToId: "someone-else",
        testRun: {
          ...baseExisting.testRunCase.testRun,
          createdById: "someone-else",
          project: {
            ...baseExisting.testRunCase.testRun.project,
            createdBy: "someone-else",
            defaultAccessType: "SPECIFIC_ROLE",
          },
        },
      },
    } as never);

    const res = await POST(createRequest({ resultId: 468927 }));

    expect(res.status).toBe(403);
    expect(txMock.testRunResults.update).not.toHaveBeenCalled();
  });

  it("404s for an already-deleted or missing result", async () => {
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue(null as never);

    const res = await POST(createRequest({ resultId: 468927 }));

    expect(res.status).toBe(404);
    expect(txMock.testRunResults.update).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const res = await POST(createRequest({ resultId: "nope" }));

    expect(res.status).toBe(400);
    expect(txMock.testRunResults.update).not.toHaveBeenCalled();
  });
});
