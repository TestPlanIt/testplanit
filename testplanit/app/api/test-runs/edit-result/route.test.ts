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
    status: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("~/lib/services/editWindow", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/editWindow")>();
  return { ...actual, assertResultEditWindowOpen: vi.fn() };
});

vi.mock("~/lib/services/resultGuards", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/resultGuards")>();
  return { ...actual, hasMissingRequiredResultField: vi.fn() };
});

// The route runs its writes inside `auditedTransaction`; hand the callback a
// mock tx so the assertions can inspect exactly what the transaction wrote.
const { txMock } = vi.hoisted(() => ({
  txMock: {
    testRunResults: { update: vi.fn(), findFirst: vi.fn() },
    testRunCases: { update: vi.fn() },
    testRunCaseIteration: { update: vi.fn(), findMany: vi.fn() },
    resultFieldValues: { update: vi.fn(), create: vi.fn() },
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
import { hasMissingRequiredResultField } from "~/lib/services/resultGuards";

/**
 * Regression coverage for the run/result status divergence: editing a result
 * updated only the `TestRunResults` row, so `TestRunCases.statusId` — the
 * column the run donut, per-case chip, and exports all read — kept the
 * pre-edit outcome. The Test Result History showed Failed while the run
 * still showed Passed.
 */
describe("Edit Result API Route — run-case status sync", () => {
  const createRequest = (body: unknown) =>
    new NextRequest("http://localhost/api/test-runs/edit-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const baseExisting = {
    id: 468927,
    statusId: 2, // Passed
    testRunCaseId: 850743,
    iterationId: null as number | null,
    resultFieldValues: [],
    issues: [],
    stepResults: [],
    testRunCase: {
      assignedToId: "user-1",
      repositoryCase: { templateId: 7 },
      testRun: {
        name: "ABT-38594",
        createdById: "user-1",
        projectId: 2,
        isCompleted: false,
        project: {
          createdBy: "user-1",
          defaultAccessType: "GLOBAL_ROLE",
          requireResultFlipJustification: false,
          requireIssueOnFailure: false,
          projectIntegrations: [],
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
    vi.mocked(hasMissingRequiredResultField).mockResolvedValue(false);
    txMock.testRunResults.update.mockResolvedValue({ id: 468927 });
  });

  it("writes the edited status onto the run case when the edited result is the latest", async () => {
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue(
      baseExisting as never
    );
    // The sync's "is this still the latest result?" probe.
    txMock.testRunResults.findFirst.mockResolvedValue({ id: 468927 });

    const res = await POST(
      createRequest({ resultId: 468927, statusId: 3 }) // Passed -> Failed
    );

    expect(res.status).toBe(200);
    expect(txMock.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 850743 },
      data: { statusId: 3 },
    });
  });

  it("leaves the run case alone when an older attempt is edited", async () => {
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue(
      baseExisting as never
    );
    // A newer attempt exists — it, not the edited row, speaks for the case.
    txMock.testRunResults.findFirst.mockResolvedValue({ id: 468999 });

    const res = await POST(createRequest({ resultId: 468927, statusId: 3 }));

    expect(res.status).toBe(200);
    expect(txMock.testRunCases.update).not.toHaveBeenCalled();
  });

  it("rolls the case up through the iteration for a parameterized result", async () => {
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue({
      ...baseExisting,
      iterationId: 500,
    } as never);
    txMock.testRunCaseIteration.findMany.mockResolvedValue([
      {
        statusId: 3,
        status: {
          id: 3,
          systemName: "failed",
          isSuccess: false,
          isFailure: true,
          isCompleted: true,
        },
      },
      {
        statusId: 2,
        status: {
          id: 2,
          systemName: "passed",
          isSuccess: true,
          isFailure: false,
          isCompleted: true,
        },
      },
    ]);
    txMock.status.findMany.mockResolvedValue([
      {
        id: 2,
        systemName: "passed",
        isSuccess: true,
        isFailure: false,
        isCompleted: true,
        order: 1,
      },
      {
        id: 3,
        systemName: "failed",
        isSuccess: false,
        isFailure: true,
        isCompleted: true,
        order: 2,
      },
    ]);

    const res = await POST(createRequest({ resultId: 468927, statusId: 3 }));

    expect(res.status).toBe(200);
    expect(txMock.testRunCaseIteration.update).toHaveBeenCalledWith({
      where: { id: 500 },
      data: { statusId: 3 },
    });
    expect(txMock.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 850743 },
      data: {
        statusId: 3,
        passedIterations: 1,
        failedIterations: 1,
        skippedIterations: 0,
      },
    });
  });

  it("does not sync when the edit is rejected before the transaction", async () => {
    vi.mocked(baseDb.testRunResults.findFirst).mockResolvedValue({
      ...baseExisting,
      testRunCase: {
        ...baseExisting.testRunCase,
        testRun: {
          ...baseExisting.testRunCase.testRun,
          isCompleted: true, // completed runs are frozen
        },
      },
    } as never);

    const res = await POST(createRequest({ resultId: 468927, statusId: 3 }));

    expect(res.status).toBe(409);
    expect(txMock.testRunCases.update).not.toHaveBeenCalled();
  });
});
