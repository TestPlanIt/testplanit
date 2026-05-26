import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    testRunCases: {
      findFirst: vi.fn(),
    },
    testRunResults: {
      findFirst: vi.fn(),
    },
    status: {
      findMany: vi.fn(),
    },
    templateResultAssignment: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("~/services/repositoryCaseSync", () => ({
  syncRepositoryCaseToElasticsearch: vi.fn().mockResolvedValue(true),
}));

import { getServerSession } from "next-auth";
import { authenticateRequest } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
import { syncRepositoryCaseToElasticsearch } from "~/services/repositoryCaseSync";

describe("Submit Result API Route", () => {
  const validBody = {
    testRunId: 1,
    testRunCaseId: 10,
    statusId: 2,
    attempt: 1,
    testRunCaseVersion: 1,
    inProgressStateId: 3,
  };

  const createRequest = (body: unknown) =>
    new NextRequest("http://localhost/api/test-runs/submit-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const baseUser = {
    id: "user-1",
    access: "USER",
    role: {
      rolePermissions: [{ canAddEdit: true }],
    },
  };

  const baseRunCase = {
    id: 10,
    assignedToId: null,
    repositoryCaseId: 55,
    repositoryCase: { automated: false, templateId: 7 },
    testRun: {
      id: 1,
      createdById: "run-owner",
      testRunType: "REGULAR",
      project: {
        createdBy: "project-owner",
        defaultAccessType: "DEFAULT",
        requireResultFlipJustification: true,
        defaultRole: null,
        assignedUsers: [],
        userPermissions: [
          {
            accessType: "SPECIFIC_ROLE",
            role: {
              name: "Tester",
              rolePermissions: [{ canAddEdit: true }],
            },
          },
        ],
        groupPermissions: [],
      },
    },
  };

  let txMocks: {
    testRunResults: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    resultFieldValues: {
      createMany: ReturnType<typeof vi.fn>;
    };
    testRunCases: {
      update: ReturnType<typeof vi.fn>;
    };
    repositoryCases: {
      update: ReturnType<typeof vi.fn>;
    };
    testRuns: {
      update: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    workflows: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    reviewRequest: {
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    appConfig: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    (authenticateRequest as any).mockResolvedValue({
      authenticated: true,
      user: { userId: "user-1", access: "USER" },
    });
    (prisma.user.findUnique as any).mockResolvedValue(baseUser);
    (prisma.testRunCases.findFirst as any).mockResolvedValue(baseRunCase);
    // Justification-on-override defaults: no prior attempt → check is a no-op,
    // so every pre-existing test path is unaffected.
    (prisma.testRunResults.findFirst as any).mockResolvedValue(null);
    (prisma.status.findMany as any).mockResolvedValue([]);
    // Required-result-fields default: no required fields → check is a no-op,
    // so every pre-existing test path is unaffected.
    (prisma.templateResultAssignment.findMany as any).mockResolvedValue([]);

    txMocks = {
      testRunResults: {
        create: vi.fn().mockResolvedValue({ id: 999 }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      resultFieldValues: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      testRunCases: {
        update: vi.fn().mockResolvedValue({ id: 10 }),
      },
      repositoryCases: {
        update: vi.fn().mockResolvedValue({ id: 55 }),
      },
      testRuns: {
        update: vi.fn().mockResolvedValue({ id: 1 }),
        // Review & Approval per-project flag lookup — default returns the
        // project with reviewWorkflowEnabled=true AND a stub current state
        // (order: 1) so the strict transitive gate can evaluate any
        // downstream gates without short-circuiting on backward-transition.
        findUnique: vi.fn().mockResolvedValue({
          project: { reviewWorkflowEnabled: true },
          state: { order: 1 },
        }),
      },
      // Review & Approval gate dependencies — default to "no gated states
      // in scope" so every pre-existing test path passes the preflight as a
      // no-op. Tests asserting the gate fires override `findMany` to return
      // a gate row with `order ≥ target.order`.
      workflows: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      reviewRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        // Consumption stamp on the gate's returned approvals — defaults to
        // a successful stamp matching one approval. Tests asserting the
        // race-loss path override to `{ count: 0 }`.
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      // System-level review-feature flag (AppConfig). Default to enabled so
      // the gate doesn't short-circuit; tests that need the flag OFF can
      // override `txMocks.appConfig.findUnique` after construction.
      appConfig: {
        findUnique: vi.fn().mockResolvedValue({ value: true }),
      },
    };

    (prisma.$transaction as any).mockImplementation(async (callback: any) =>
      callback(txMocks)
    );
  });

  it("returns 401 when user is not authenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (authenticateRequest as any).mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid payload", async () => {
    const response = await POST(createRequest({ testRunId: 1 }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid input");
  });

  it("returns 404 when test run case is not found", async () => {
    (prisma.testRunCases.findFirst as any).mockResolvedValue(null);

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.code).toBe("TEST_RUN_CASE_NOT_FOUND");
  });

  it("returns 403 when user has no permission", async () => {
    (prisma.testRunCases.findFirst as any).mockResolvedValue({
      ...baseRunCase,
      testRun: {
        ...baseRunCase.testRun,
        project: {
          ...baseRunCase.testRun.project,
          userPermissions: [
            {
              accessType: "NO_ACCESS",
              role: null,
            },
          ],
        },
      },
    });

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe("PERMISSION_DENIED");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("submits result and updates test run case atomically when permission is valid", async () => {
    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.result.id).toBe(999);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txMocks.testRunResults.create).toHaveBeenCalledTimes(1);
    expect(txMocks.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { statusId: 2 },
    });
    expect(txMocks.testRuns.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { stateId: 3 },
    });
  });

  it("returns 500 if transaction fails", async () => {
    txMocks.testRunCases.update.mockRejectedValue(new Error("update failed"));

    const response = await POST(createRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe("SUBMIT_RESULT_FAILED");
  });

  describe("automated flag promotion", () => {
    const automatedRunCase = {
      ...baseRunCase,
      repositoryCaseId: 55,
      repositoryCase: { automated: false },
      testRun: {
        ...baseRunCase.testRun,
        testRunType: "JUNIT",
      },
    };

    it("flips repositoryCase.automated to true when an automated run submits a result for a manual case", async () => {
      (prisma.testRunCases.findFirst as any).mockResolvedValue(
        automatedRunCase
      );

      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      expect(txMocks.repositoryCases.update).toHaveBeenCalledWith({
        where: { id: 55 },
        data: { automated: true },
      });
    });

    it("triggers ES re-sync after flipping the automated flag", async () => {
      (prisma.testRunCases.findFirst as any).mockResolvedValue(
        automatedRunCase
      );

      await POST(createRequest(validBody));

      // Allow the fire-and-forget void promise to settle
      await Promise.resolve();

      expect(syncRepositoryCaseToElasticsearch).toHaveBeenCalledWith(55);
    });

    it("does not flip automated flag when run type is REGULAR", async () => {
      // baseRunCase already has testRunType: "REGULAR"
      await POST(createRequest(validBody));

      expect(txMocks.repositoryCases.update).not.toHaveBeenCalled();
      expect(syncRepositoryCaseToElasticsearch).not.toHaveBeenCalled();
    });

    it("does not flip automated flag when case is already marked automated", async () => {
      (prisma.testRunCases.findFirst as any).mockResolvedValue({
        ...automatedRunCase,
        repositoryCase: { automated: true },
      });

      await POST(createRequest(validBody));

      expect(txMocks.repositoryCases.update).not.toHaveBeenCalled();
      expect(syncRepositoryCaseToElasticsearch).not.toHaveBeenCalled();
    });

    it.each([
      "JUNIT",
      "TESTNG",
      "XUNIT",
      "NUNIT",
      "MSTEST",
      "MOCHA",
      "CUCUMBER",
    ])("flips the flag for automated run type %s", async (testRunType) => {
      (prisma.testRunCases.findFirst as any).mockResolvedValue({
        ...automatedRunCase,
        testRun: { ...automatedRunCase.testRun, testRunType },
      });

      await POST(createRequest(validBody));

      expect(txMocks.repositoryCases.update).toHaveBeenCalledWith({
        where: { id: 55 },
        data: { automated: true },
      });
    });
  });

  describe("review gate", () => {
    it("returns 403 with structured payload when the in-progress target state is gated and has no approval", async () => {
      // Strict transitive gate setup: target state has order 4; the gated
      // states list contains a single gate AT the target (id matches the
      // inProgressStateId, order=4); the run is at state order 1 by default
      // — the gate at order 4 fires.
      txMocks.workflows.findUnique.mockResolvedValue({ order: 4 });
      txMocks.workflows.findMany.mockResolvedValue([
        { id: validBody.inProgressStateId, order: 4 },
      ]);
      // No approved+unconsumed ReviewRequest for the gate → helper throws.
      txMocks.reviewRequest.findFirst.mockResolvedValue(null);

      const response = await POST(createRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toMatchObject({
        code: "REVIEW_REQUIRED",
        entityType: "RUN",
        entityId: validBody.testRunId,
        toStateId: validBody.inProgressStateId,
      });
      // Auto-flip must NOT have fired when the gate blocked.
      expect(txMocks.testRuns.update).not.toHaveBeenCalled();
    });

    it("allows the auto-flip when the gated target state has an approved + unconsumed ReviewRequest", async () => {
      txMocks.workflows.findUnique.mockResolvedValue({ order: 4 });
      txMocks.workflows.findMany.mockResolvedValue([
        { id: validBody.inProgressStateId, order: 4 },
      ]);
      txMocks.reviewRequest.findFirst.mockResolvedValue({ id: "approved-1" });

      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      expect(txMocks.testRuns.update).toHaveBeenCalledWith({
        where: { id: validBody.testRunId },
        data: { stateId: validBody.inProgressStateId },
      });
      // Consumption stamp fires on every approval id the gate returned so
      // the same approval can't be re-used on a subsequent transition.
      expect(txMocks.reviewRequest.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["approved-1"] }, consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it("returns 403 REVIEW_REQUIRED when the consumption stamp loses the race (count < expected)", async () => {
      txMocks.workflows.findUnique.mockResolvedValue({ order: 4 });
      txMocks.workflows.findMany.mockResolvedValue([
        { id: validBody.inProgressStateId, order: 4 },
      ]);
      txMocks.reviewRequest.findFirst.mockResolvedValue({ id: "approved-1" });
      // Another caller consumed the approval first — count comes back at 0.
      txMocks.reviewRequest.updateMany.mockResolvedValue({ count: 0 });

      const response = await POST(createRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toMatchObject({
        code: "REVIEW_REQUIRED",
        entityType: "RUN",
      });
    });

    it("skips the preflight entirely when there is a previous result (no auto-flip)", async () => {
      // Existing previous result → the auto-flip block (and the preflight) is
      // bypassed.
      txMocks.testRunResults.findFirst.mockResolvedValue({ id: 1 });

      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      expect(txMocks.workflows.findUnique).not.toHaveBeenCalled();
      expect(txMocks.testRuns.update).not.toHaveBeenCalled();
    });
  });

  describe("mandatory justification on override", () => {
    // validBody submits statusId 2 (a failure-class outcome).
    const failedStatus = {
      id: 2,
      isSuccess: false,
      isFailure: true,
      isCompleted: true,
    };
    const passedStatus = {
      id: 7,
      isSuccess: true,
      isFailure: false,
      isCompleted: true,
    };
    // A not-completed status (untested/blocked): clearing to it, or recording
    // the first result from it, is not an override.
    const untestedStatus = {
      id: 2,
      isSuccess: false,
      isFailure: false,
      isCompleted: false,
    };
    const notesWithText = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Overrode after re-run on a fixed env" },
          ],
        },
      ],
    };

    it("does not enforce justification when the project setting is disabled", async () => {
      (prisma.testRunCases.findFirst as any).mockResolvedValue({
        ...baseRunCase,
        testRun: {
          ...baseRunCase.testRun,
          project: {
            ...baseRunCase.testRun.project,
            requireResultFlipJustification: false,
          },
        },
      });
      // A different-outcome override with empty notes would normally be
      // rejected, but the setting is off so it is accepted.
      (prisma.testRunResults.findFirst as any).mockResolvedValue({
        statusId: 7,
      });
      (prisma.status.findMany as any).mockResolvedValue([
        passedStatus,
        failedStatus,
      ]);

      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      // The prior-attempt lookup is skipped entirely when the setting is off.
      expect(prisma.testRunResults.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("accepts a first-ever submission with empty notes", async () => {
      // No prior attempt (default mock) → the override check is a no-op.
      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      expect(prisma.status.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("accepts a same-outcome re-submission with empty notes", async () => {
      (prisma.testRunResults.findFirst as any).mockResolvedValue({
        statusId: 2,
      });
      (prisma.status.findMany as any).mockResolvedValue([failedStatus]);

      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("rejects a different-outcome override with empty notes", async () => {
      (prisma.testRunResults.findFirst as any).mockResolvedValue({
        statusId: 7,
      });
      (prisma.status.findMany as any).mockResolvedValue([
        passedStatus,
        failedStatus,
      ]);

      const response = await POST(createRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe("JUSTIFICATION_REQUIRED");
      // Rejection is pre-transaction — no result row is ever created.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("accepts a different-outcome override when notes are provided", async () => {
      (prisma.testRunResults.findFirst as any).mockResolvedValue({
        statusId: 7,
      });
      (prisma.status.findMany as any).mockResolvedValue([
        passedStatus,
        failedStatus,
      ]);

      const response = await POST(
        createRequest({ ...validBody, notes: notesWithText })
      );

      expect(response.status).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("accepts clearing a completed result to a non-completed status without notes", async () => {
      // Prior is completed (passed); submission clears to untested (statusId 2).
      (prisma.testRunResults.findFirst as any).mockResolvedValue({
        statusId: 7,
      });
      (prisma.status.findMany as any).mockResolvedValue([
        passedStatus,
        untestedStatus,
      ]);

      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("accepts the first completed result after a non-completed attempt without notes", async () => {
      // Prior is not completed → recording the first real result is not an
      // override and needs no justification.
      (prisma.testRunResults.findFirst as any).mockResolvedValue({
        statusId: 9,
      });
      (prisma.status.findMany as any).mockResolvedValue([
        { id: 9, isSuccess: false, isFailure: false, isCompleted: false },
        failedStatus,
      ]);

      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("scopes the prior-attempt lookup to the submitted iteration", async () => {
      // Different-outcome override with empty notes → rejected pre-transaction,
      // so this also confirms the lookup is scoped to iteration 42.
      (prisma.testRunResults.findFirst as any).mockResolvedValue({
        statusId: 7,
      });
      (prisma.status.findMany as any).mockResolvedValue([
        passedStatus,
        failedStatus,
      ]);

      const response = await POST(
        createRequest({ ...validBody, iterationId: 42 })
      );

      expect(response.status).toBe(400);
      expect(prisma.testRunResults.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            testRunCaseId: validBody.testRunCaseId,
            iterationId: 42,
            isDeleted: false,
          }),
          orderBy: { executedAt: "desc" },
        })
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("mandatory result fields", () => {
    const requireField = (fieldId: number) =>
      (prisma.templateResultAssignment.findMany as any).mockResolvedValue([
        { resultFieldId: fieldId },
      ]);

    it("rejects a submission missing a required result field", async () => {
      requireField(100);

      const response = await POST(createRequest(validBody));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe("REQUIRED_FIELDS_MISSING");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects when a required field value is empty", async () => {
      requireField(100);

      const response = await POST(
        createRequest({
          ...validBody,
          fieldValues: [{ fieldId: 100, value: "" }],
        })
      );

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("REQUIRED_FIELDS_MISSING");
    });

    it("accepts when the required field is provided and persists the values", async () => {
      requireField(100);

      const response = await POST(
        createRequest({
          ...validBody,
          fieldValues: [{ fieldId: 100, value: "High" }],
        })
      );

      expect(response.status).toBe(200);
      expect(txMocks.resultFieldValues.createMany).toHaveBeenCalledWith({
        data: [{ fieldId: 100, value: "High", testRunResultsId: 999 }],
      });
    });

    it("does not enforce when the template has no required fields", async () => {
      const response = await POST(
        createRequest({
          ...validBody,
          fieldValues: [{ fieldId: 100, value: "x" }],
        })
      );

      expect(response.status).toBe(200);
      expect(txMocks.resultFieldValues.createMany).toHaveBeenCalled();
    });

    it("writes no field values when none are submitted", async () => {
      const response = await POST(createRequest(validBody));

      expect(response.status).toBe(200);
      expect(txMocks.resultFieldValues.createMany).not.toHaveBeenCalled();
    });
  });
});
