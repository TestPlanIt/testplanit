import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    projects: {
      findFirst: vi.fn(),
    },
    repositoryCases: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    repositoryCaseVersions: {
      createMany: vi.fn(),
    },
    caseFieldValues: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    steps: {
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditBulkUpdate: vi.fn(() => Promise.resolve()),
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { auditBulkUpdate } from "~/lib/services/auditLog";

describe("Bulk Edit API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      access: "USER",
    },
  };

  const mockProject = {
    id: 1,
    name: "Test Project",
    isDeleted: false,
  };

  const mockCases = [
    {
      id: 1,
      name: "Test Case 1",
      projectId: 1,
      stateId: 1,
      automated: false,
      estimate: 300,
      currentVersion: 1,
      isDeleted: false,
      project: { name: "Test Project" },
      folder: { name: "Folder 1" },
      template: { templateName: "Template 1" },
      state: { name: "Not Started" },
      creator: { name: "Creator 1" },
      caseTags: [{ tag: { name: "tag1" } }],
      caseIssues: [],
      steps: [],
      caseFieldValues: [],
    },
    {
      id: 2,
      name: "Test Case 2",
      projectId: 1,
      stateId: 1,
      automated: true,
      estimate: 600,
      currentVersion: 2,
      isDeleted: false,
      project: { name: "Test Project" },
      folder: { name: "Folder 1" },
      template: { templateName: "Template 1" },
      state: { name: "Not Started" },
      creator: { name: "Creator 1" },
      caseTags: [],
      caseIssues: [],
      steps: [],
      caseFieldValues: [],
    },
  ];

  const createRequest = (
    body: any,
    projectId: string = "1"
  ): [NextRequest, { params: Promise<{ projectId: string }> }] => {
    const request = {
      json: async () => body,
      headers: new Headers(),
    } as NextRequest;
    return [request, { params: Promise.resolve({ projectId }) }];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
    (baseDb.projects.findFirst as any).mockResolvedValue(mockProject);
    (baseDb.repositoryCases.findMany as any).mockResolvedValue(mockCases);

    // Set up a default transaction mock with all necessary methods
    (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue([]),
        $queryRaw: vi.fn().mockResolvedValue([]),
        repositoryCaseVersions: {
          create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        repositoryCases: {
          findUnique: vi.fn().mockResolvedValue(mockCases[0]),
          update: vi.fn().mockResolvedValue({}),
        },
        caseFieldValues: {
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
        steps: {
          create: vi.fn(),
          update: vi.fn(),
          deleteMany: vi.fn(),
        },
        workflows: { findUnique: vi.fn().mockResolvedValue(null) },
        reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
        repositoryCaseTag: {
          create: vi.fn(),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        repositoryCaseIssue: {
          create: vi.fn(),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
      };
      return callback(tx);
    });
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 for invalid project ID", async () => {
      const [request, context] = createRequest(
        {
          caseIds: [1, 2],
          updates: { state: 2 },
        },
        "invalid"
      );
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid project ID");
    });

    it("returns 400 when caseIds is not an array", async () => {
      const [request, context] = createRequest({
        caseIds: "not-an-array",
        updates: { state: 2 },
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });

    it("returns 400 when caseIds contains non-numbers", async () => {
      const [request, context] = createRequest({
        caseIds: [1, "two", 3],
        updates: { state: 2 },
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });

    it("returns 404 when project not found", async () => {
      (baseDb.projects.findFirst as any).mockResolvedValue(null);

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Project not found or access denied");
    });

    it("returns 400 when some cases not found", async () => {
      (baseDb.repositoryCases.findMany as any).mockResolvedValue([
        mockCases[0],
      ]);

      const [request, context] = createRequest({
        caseIds: [1, 2, 3],
        updates: { state: 2 },
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(
        "Some cases not found or do not belong to this project"
      );
    });
  });

  describe("State Updates", () => {
    it("updates stateId correctly (not state relation)", async () => {
      const transactionMock = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: {
            create: vi.fn(),
            update: vi.fn(),
            deleteMany: vi.fn(),
          },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        };
        return callback(tx);
      });

      (baseDb.$transaction as any).mockImplementation(transactionMock);

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 14 },
        createVersions: true,
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify the transaction was called
      expect(baseDb.$transaction).toHaveBeenCalled();

      // Get the callback passed to $transaction and verify it updates stateId
      const transactionCallback = transactionMock.mock.calls[0][0];
      const mockTx = {
        $executeRaw: vi.fn().mockResolvedValue([]),
        $queryRaw: vi.fn().mockResolvedValue([]),
        repositoryCaseVersions: {
          create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        repositoryCases: {
          findUnique: vi.fn().mockResolvedValue(mockCases[0]),
          update: vi.fn().mockResolvedValue({}),
        },
        caseFieldValues: {
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
        steps: {
          create: vi.fn(),
          update: vi.fn(),
          deleteMany: vi.fn(),
        },
        workflows: { findUnique: vi.fn().mockResolvedValue(null) },
        reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
        repositoryCaseTag: {
          create: vi.fn(),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        repositoryCaseIssue: {
          create: vi.fn(),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
      };

      await transactionCallback(mockTx);

      // Verify that update was called with stateId, not state
      expect(mockTx.repositoryCases.update).toHaveBeenCalledTimes(2);
      const updateCalls = mockTx.repositoryCases.update.mock.calls;

      // Check that each call uses stateId (not state)
      updateCalls.forEach((call: any) => {
        const updateData = call[0].data;
        expect(updateData).toHaveProperty("stateId", 14);
        expect(updateData).not.toHaveProperty("state");
        expect(updateData).toHaveProperty("currentVersion");
      });
    });

    it("handles state update with large ID value", async () => {
      // Override findMany to return just 1 case for this test
      (baseDb.repositoryCases.findMany as any).mockResolvedValue([
        mockCases[0],
      ]);

      const transactionMock = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: {
            create: vi.fn(),
            update: vi.fn(),
            deleteMany: vi.fn(),
          },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        };
        return callback(tx);
      });

      (baseDb.$transaction as any).mockImplementation(transactionMock);

      // Large state ID should be valid
      const [request, context] = createRequest({
        caseIds: [1],
        updates: { state: 999999 },
        createVersions: false,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      // Verify stateId is set correctly by checking the transaction callback
      const transactionCallback = transactionMock.mock.calls[0][0];
      const mockTx = {
        $executeRaw: vi.fn().mockResolvedValue([]),
        $queryRaw: vi.fn().mockResolvedValue([]),
        repositoryCaseVersions: {
          create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        repositoryCases: {
          findUnique: vi.fn().mockResolvedValue(mockCases[0]),
          update: vi.fn().mockResolvedValue({}),
        },
        caseFieldValues: {
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
        steps: {
          create: vi.fn(),
          update: vi.fn(),
          deleteMany: vi.fn(),
        },
        workflows: { findUnique: vi.fn().mockResolvedValue(null) },
        reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
        repositoryCaseTag: {
          create: vi.fn(),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        repositoryCaseIssue: {
          create: vi.fn(),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
      };

      await transactionCallback(mockTx);

      expect(mockTx.repositoryCases.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stateId: 999999,
          }),
        })
      );
    });
  });

  describe("Standard Field Updates", () => {
    it("updates name field correctly", async () => {
      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: mockTxUpdate,
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { name: "Updated Name" },
        createVersions: true,
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify name was updated
      expect(mockTxUpdate).toHaveBeenCalledTimes(2);
      mockTxUpdate.mock.calls.forEach((call: any) => {
        expect(call[0].data).toHaveProperty("name", "Updated Name");
      });
    });

    it("updates automated field correctly", async () => {
      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: mockTxUpdate,
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { automated: true },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      mockTxUpdate.mock.calls.forEach((call: any) => {
        expect(call[0].data).toHaveProperty("automated", true);
      });
    });

    it("updates estimate field correctly", async () => {
      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: mockTxUpdate,
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { estimate: 900 },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      mockTxUpdate.mock.calls.forEach((call: any) => {
        expect(call[0].data).toHaveProperty("estimate", 900);
      });
    });

    it("updates multiple fields at once", async () => {
      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: mockTxUpdate,
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {
          name: "Bulk Updated",
          state: 3,
          automated: true,
          estimate: 1200,
        },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      mockTxUpdate.mock.calls.forEach((call: any) => {
        const data = call[0].data;
        expect(data).toHaveProperty("name", "Bulk Updated");
        expect(data).toHaveProperty("stateId", 3);
        expect(data).toHaveProperty("automated", true);
        expect(data).toHaveProperty("estimate", 1200);
      });
    });
  });

  describe("Tags Updates", () => {
    it("handles tags connect correctly", async () => {
      // Tag links now live on the explicit RepositoryCaseTag join model, so a
      // connect becomes a createMany of {caseId, tagId} join rows (once per
      // case in the loop) rather than a nested connect on the case update.
      const mockTagCreateMany = vi.fn().mockResolvedValue({ count: 2 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: mockTagCreateMany,
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {
          tags: {
            connect: [{ id: 1 }, { id: 2 }],
          },
        },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      // One createMany per case, each adding both tag links for that case.
      expect(mockTagCreateMany).toHaveBeenCalledTimes(2);
      mockTagCreateMany.mock.calls.forEach((call: any) => {
        const caseId = call[0].data[0].caseId;
        expect(call[0]).toEqual({
          data: [
            { caseId, tagId: 1 },
            { caseId, tagId: 2 },
          ],
          skipDuplicates: true,
        });
      });
    });

    it("handles tags disconnect correctly", async () => {
      // A disconnect becomes a deleteMany of the matching join rows scoped to
      // the case and the tag ids being removed.
      const mockTagDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: mockTagDeleteMany,
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {
          tags: {
            disconnect: [{ id: 3 }],
          },
        },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      // One deleteMany per case removing the tagId=3 join row.
      expect(mockTagDeleteMany).toHaveBeenCalledTimes(2);
      mockTagDeleteMany.mock.calls.forEach((call: any) => {
        const caseId = call[0].where.caseId;
        expect(call[0]).toEqual({
          where: { caseId, tagId: { in: [3] } },
        });
      });
    });
  });

  describe("Issues Updates", () => {
    it("handles issues connect correctly", async () => {
      // Issue links now live on the explicit RepositoryCaseIssue join model, so
      // a connect becomes a createMany of {caseId, issueId} join rows (once per
      // case in the loop) rather than a nested connect on the case update.
      const mockIssueCreateMany = vi.fn().mockResolvedValue({ count: 1 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: mockIssueCreateMany,
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {
          issues: {
            connect: [{ id: 10 }],
          },
        },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      // One createMany per case linking issueId=10.
      expect(mockIssueCreateMany).toHaveBeenCalledTimes(2);
      mockIssueCreateMany.mock.calls.forEach((call: any) => {
        const caseId = call[0].data[0].caseId;
        expect(call[0]).toEqual({
          data: [{ caseId, issueId: 10 }],
          skipDuplicates: true,
        });
      });
    });

    it("handles issues disconnect correctly", async () => {
      // A disconnect becomes a deleteMany of the matching join rows scoped to
      // the case and the issue ids being removed.
      const mockIssueDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: mockIssueDeleteMany,
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {
          issues: {
            disconnect: [{ id: 10 }],
          },
        },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      // One deleteMany per case removing the issueId=10 join row.
      expect(mockIssueDeleteMany).toHaveBeenCalledTimes(2);
      mockIssueDeleteMany.mock.calls.forEach((call: any) => {
        const caseId = call[0].where.caseId;
        expect(call[0]).toEqual({
          where: { caseId, issueId: { in: [10] } },
        });
      });
    });
  });

  describe("Custom Field Updates", () => {
    it("creates custom field value when it doesn't exist", async () => {
      const mockTxCreate = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: mockTxCreate,
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {},
        customFieldUpdates: [
          { fieldId: 5, value: "New Value", operation: "create" },
        ],
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      expect(mockTxCreate).toHaveBeenCalledTimes(2);
      mockTxCreate.mock.calls.forEach((call: any) => {
        expect(call[0].data).toMatchObject({
          fieldId: 5,
          value: "New Value",
        });
      });
    });

    it("updates existing custom field value", async () => {
      const casesWithFieldValues = mockCases.map((c) => ({
        ...c,
        caseFieldValues: [{ id: 100, fieldId: 5, value: "Old Value" }],
      }));
      (baseDb.repositoryCases.findMany as any).mockResolvedValue(
        casesWithFieldValues
      );

      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: mockTxUpdate,
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {},
        customFieldUpdates: [
          { fieldId: 5, value: "Updated Value", operation: "update" },
        ],
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      expect(mockTxUpdate).toHaveBeenCalled();
      mockTxUpdate.mock.calls.forEach((call: any) => {
        expect(call[0].data).toHaveProperty("value", "Updated Value");
      });
    });

    it("deletes custom field value", async () => {
      const casesWithFieldValues = mockCases.map((c) => ({
        ...c,
        caseFieldValues: [{ id: 100, fieldId: 5, value: "Value to delete" }],
      }));
      (baseDb.repositoryCases.findMany as any).mockResolvedValue(
        casesWithFieldValues
      );

      const mockTxDelete = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: mockTxDelete,
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {},
        customFieldUpdates: [{ fieldId: 5, value: null, operation: "delete" }],
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      expect(mockTxDelete).toHaveBeenCalled();
    });
  });

  describe("Version Creation", () => {
    it("creates versions when createVersions is true", async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: 1, version: 1 });
      const mockCreateMany = vi.fn().mockResolvedValue({ count: 2 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: mockCreate,
            createMany: mockCreateMany,
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
        createVersions: true,
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.result.versionsCreated).toBe(2);
      // The new testCaseVersionService uses create() instead of createMany()
      expect(mockCreate).toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("snapshots post-update relations, not the stale pre-update case", async () => {
      // Pre-update the case is linked to issue 10; the bulk edit disconnects
      // it. The version service re-reads the row inside the transaction, so the
      // snapshot must reflect the disconnect — not the in-memory pre-update
      // relations the route loop holds.
      const preUpdateCase = {
        ...mockCases[0],
        id: 1,
        caseIssues: [
          { issue: { id: 10, name: "BUG-10", externalId: "BUG-10" } },
        ],
      };
      const postUpdateCase = {
        ...mockCases[0],
        id: 1,
        caseIssues: [],
      };
      (baseDb.repositoryCases.findMany as any).mockResolvedValue([
        preUpdateCase,
      ]);

      const mockCreate = vi.fn().mockResolvedValue({ id: 1, version: 1 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: mockCreate,
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          repositoryCases: {
            // The service's own fetch returns the freshly-updated row
            findUnique: vi.fn().mockResolvedValue(postUpdateCase),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1],
        updates: { issues: { disconnect: [{ id: 10 }] } },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      // The snapshot reflects the post-update (disconnected) issue set, proving
      // the route no longer passes the stale pre-update relations as overrides.
      expect(mockCreate.mock.calls[0][0].data.issues).toEqual([]);
    });

    it("snapshots the new state name when the state is bulk-changed", async () => {
      // Pre-update the case is in "Old State"; the bulk edit moves it to state
      // 2. The snapshot must record the new state's name, not the stale one.
      const preUpdateCase = {
        ...mockCases[0],
        id: 1,
        stateId: 1,
        state: { name: "Old State" },
      };
      const postUpdateCase = {
        ...mockCases[0],
        id: 1,
        stateId: 2,
        state: { name: "New State" },
      };
      (baseDb.repositoryCases.findMany as any).mockResolvedValue([
        preUpdateCase,
      ]);

      const mockCreate = vi.fn().mockResolvedValue({ id: 1, version: 1 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: mockCreate,
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(postUpdateCase),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1],
        updates: { state: 2 },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][0].data.stateId).toBe(2);
      expect(mockCreate.mock.calls[0][0].data.stateName).toBe("New State");
    });

    it("skips version creation when createVersions is false", async () => {
      const mockCreateMany = vi.fn().mockResolvedValue({ count: 0 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: { createMany: mockCreateMany },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
        createVersions: false,
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.result.versionsCreated).toBe(0);
      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });

  describe("Steps Updates", () => {
    it("handles steps replace operation", async () => {
      const mockDeleteMany = vi.fn().mockResolvedValue({ count: 2 });
      const mockCreate = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: {
            create: mockCreate,
            update: vi.fn(),
            deleteMany: mockDeleteMany,
          },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {},
        stepsUpdates: {
          operation: "replace",
          newSteps: [
            {
              step: { type: "doc", content: [] },
              expectedResult: { type: "doc", content: [] },
              order: 0,
            },
          ],
        },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);
      expect(mockDeleteMany).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenCalled();
    });

    it("handles steps search-replace operation", async () => {
      const casesWithSteps = mockCases.map((c) => ({
        ...c,
        steps: [
          {
            id: 1,
            step: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Click login button"}]}]}',
            expectedResult:
              '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"User is logged in"}]}]}',
            order: 0,
          },
        ],
      }));
      (baseDb.repositoryCases.findMany as any).mockResolvedValue(
        casesWithSteps
      );

      const mockStepUpdate = vi.fn().mockResolvedValue({});
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: {
            create: vi.fn(),
            update: mockStepUpdate,
            deleteMany: vi.fn(),
          },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {},
        stepsUpdates: {
          operation: "search-replace",
          searchPattern: "login",
          replacePattern: "signin",
          searchOptions: {
            useRegex: false,
            caseSensitive: false,
          },
        },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);
      expect(mockStepUpdate).toHaveBeenCalled();
    });
  });

  describe("Audit Logging", () => {
    it("calls auditBulkUpdate after successful update", async () => {
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
        createVersions: true,
      });
      await POST(request, context);

      // Wait a tick for the audit log promise to be called
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(auditBulkUpdate).toHaveBeenCalledWith(
        "RepositoryCases",
        2,
        { caseIds: [1, 2] },
        1
      );
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when transaction fails", async () => {
      (baseDb.$transaction as any).mockRejectedValue(new Error("DB Error"));

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
        createVersions: true,
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to perform bulk edit");
    });

    it("handles timeout gracefully", async () => {
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        // v3 $transaction options accept only { isolationLevel } (no
        // maxWait/timeout), so there's no timeout option to assert here.
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: {
            findUnique: vi.fn().mockResolvedValue({ value: true }),
          },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);
    });
  });

  describe("Admin Access", () => {
    it("allows admin to access any project", async () => {
      const adminSession = {
        user: {
          ...mockSession.user,
          access: "ADMIN",
        },
      };
      (getServerSession as any).mockResolvedValue(adminSession);

      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: vi.fn().mockResolvedValue(null) },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 2 },
        createVersions: true,
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);

      // Verify simplified query for admin
      expect(baseDb.projects.findFirst).toHaveBeenCalledWith({
        where: { id: 1, isDeleted: false },
      });
    });
  });

  describe("Review Gate", () => {
    it("returns 403 with structured payload when ReviewGateError is thrown", async () => {
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          // Strict transitive gate setup:
          //   - target state (id=99) is gated and at order 4
          //   - gated-states list returns the gate row so the helper sees it
          //   - mock case row's state.order is unset → treated as "no prior
          //     state", so any gate at or below target order blocks
          //   - no approved+unconsumed ReviewRequest → helper throws
          workflows: {
            findUnique: vi.fn().mockResolvedValue({ order: 4 }),
            findMany: vi.fn().mockResolvedValue([{ id: 99, order: 4 }]),
          },
          reviewRequest: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        };
        return callback(tx);
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 99 },
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toMatchObject({
        code: "REVIEW_REQUIRED",
        entityType: "CASE",
        toStateId: 99,
      });
      expect(typeof data.error.entityId).toBe("number");
    });

    it("stamps consumedAt on every approval the strict-transitive gate returns (per case in the loop)", async () => {
      const txReviewRequestUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: {
            findUnique: vi.fn().mockResolvedValue({ order: 4 }),
            findMany: vi.fn().mockResolvedValue([{ id: 99, order: 4 }]),
          },
          reviewRequest: {
            // Gate finds an approved+unconsumed approval for the target gate.
            findFirst: vi.fn().mockResolvedValue({ id: "case-approval-1" }),
            // Consumption stamp fires after the case update succeeds.
            updateMany: txReviewRequestUpdateMany,
          },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        };
        return callback(tx);
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 99 },
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);
      // Stamp fires once per case (the loop calls assertReviewGatePasses
      // per case + stamps its returned approvals inline).
      expect(txReviewRequestUpdateMany).toHaveBeenCalledTimes(2);
      expect(txReviewRequestUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ["case-approval-1"] }, consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it("returns 409 with PENDING_REVIEW_EXISTS when AlreadyPendingError is thrown", async () => {
      const { AlreadyPendingError } = await import("~/lib/utils/errors");
      (baseDb.$transaction as any).mockImplementation(async () => {
        throw new AlreadyPendingError("CASE", 1, "existing-request-id");
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { state: 99 },
      });
      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toEqual({ code: "PENDING_REVIEW_EXISTS" });
    });

    it("skips the gate when stateId is not part of the update", async () => {
      const findUniqueMock = vi.fn().mockResolvedValue(null);
      (baseDb.$transaction as any).mockImplementation(async (callback: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue([]),
          $queryRaw: vi.fn().mockResolvedValue([]),
          repositoryCaseVersions: {
            create: vi.fn().mockResolvedValue({ id: 1, version: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
            findUnique: vi.fn().mockResolvedValue(mockCases[0]),
            update: vi.fn().mockResolvedValue({}),
          },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          workflows: { findUnique: findUniqueMock },
          reviewRequest: { findFirst: vi.fn().mockResolvedValue(null) },
          repositoryCaseTag: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          repositoryCaseIssue: {
            create: vi.fn(),
            createMany: vi.fn().mockResolvedValue({ count: 0 }),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            findMany: vi.fn().mockResolvedValue([]),
          },
          appConfig: { findUnique: vi.fn().mockResolvedValue({ value: true }) },
        };
        return callback(tx);
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: { name: "renamed only" },
      });
      const response = await POST(request, context);

      expect(response.status).toBe(200);
      // Gate is gated by `updateData.stateId !== undefined`; with no state in the
      // update, the preflight must not even consult workflows.
      expect(findUniqueMock).not.toHaveBeenCalled();
    });
  });
});
