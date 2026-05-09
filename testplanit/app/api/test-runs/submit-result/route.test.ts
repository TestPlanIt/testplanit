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
    repositoryCase: { automated: false },
    testRun: {
      id: 1,
      createdById: "run-owner",
      testRunType: "REGULAR",
      project: {
        createdBy: "project-owner",
        defaultAccessType: "DEFAULT",
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
    testRunCases: {
      update: ReturnType<typeof vi.fn>;
    };
    repositoryCases: {
      update: ReturnType<typeof vi.fn>;
    };
    testRuns: {
      update: ReturnType<typeof vi.fn>;
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

    txMocks = {
      testRunResults: {
        create: vi.fn().mockResolvedValue({ id: 999 }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      testRunCases: {
        update: vi.fn().mockResolvedValue({ id: 10 }),
      },
      repositoryCases: {
        update: vi.fn().mockResolvedValue({ id: 55 }),
      },
      testRuns: {
        update: vi.fn().mockResolvedValue({ id: 1 }),
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
});
