import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
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
import { prisma } from "~/lib/prisma";
import { auditBulkUpdate } from "~/lib/services/auditLog";
import { ProjectAccessType } from "@prisma/client";

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
      tags: [{ name: "tag1" }],
      issues: [],
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
      tags: [],
      issues: [],
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
    } as NextRequest;
    return [request, { params: Promise.resolve({ projectId }) }];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
    (prisma.projects.findFirst as any).mockResolvedValue(mockProject);
    (prisma.repositoryCases.findMany as any).mockResolvedValue(mockCases);
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
      (prisma.projects.findFirst as any).mockResolvedValue(null);

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
      (prisma.repositoryCases.findMany as any).mockResolvedValue([mockCases[0]]);

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
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: {
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
        };
        return callback(tx);
      });

      (prisma.$transaction as any).mockImplementation(transactionMock);

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
      expect(prisma.$transaction).toHaveBeenCalled();

      // Get the callback passed to $transaction and verify it updates stateId
      const transactionCallback = transactionMock.mock.calls[0][0];
      const mockTx = {
        repositoryCaseVersions: {
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        repositoryCases: {
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
      (prisma.repositoryCases.findMany as any).mockResolvedValue([mockCases[0]]);

      const transactionMock = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          repositoryCases: {
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
        };
        return callback(tx);
      });

      (prisma.$transaction as any).mockImplementation(transactionMock);

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
        repositoryCaseVersions: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        repositoryCases: {
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
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: mockTxUpdate },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: mockTxUpdate },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: mockTxUpdate },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: mockTxUpdate },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: mockTxUpdate },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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

      mockTxUpdate.mock.calls.forEach((call: any) => {
        expect(call[0].data.tags).toEqual({
          connect: [{ id: 1 }, { id: 2 }],
        });
      });
    });

    it("handles tags disconnect correctly", async () => {
      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: mockTxUpdate },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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

      mockTxUpdate.mock.calls.forEach((call: any) => {
        expect(call[0].data.tags).toEqual({
          disconnect: [{ id: 3 }],
        });
      });
    });
  });

  describe("Issues Updates", () => {
    it("handles issues connect correctly", async () => {
      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: mockTxUpdate },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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

      mockTxUpdate.mock.calls.forEach((call: any) => {
        expect(call[0].data.issues).toEqual({
          connect: [{ id: 10 }],
        });
      });
    });
  });

  describe("Custom Field Updates", () => {
    it("creates custom field value when it doesn't exist", async () => {
      const mockTxCreate = vi.fn().mockResolvedValue({});
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: {
            create: mockTxCreate,
            update: vi.fn(),
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      (prisma.repositoryCases.findMany as any).mockResolvedValue(
        casesWithFieldValues
      );

      const mockTxUpdate = vi.fn().mockResolvedValue({});
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: {
            create: vi.fn(),
            update: mockTxUpdate,
            delete: vi.fn(),
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      (prisma.repositoryCases.findMany as any).mockResolvedValue(
        casesWithFieldValues
      );

      const mockTxDelete = vi.fn().mockResolvedValue({});
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: {
            create: vi.fn(),
            update: vi.fn(),
            delete: mockTxDelete,
          },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      const mockCreateMany = vi.fn().mockResolvedValue({ count: 2 });
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: { createMany: mockCreateMany },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      expect(mockCreateMany).toHaveBeenCalled();

      // Verify version numbers are incremented (currentVersion + 1)
      const createManyCall = mockCreateMany.mock.calls[0][0];
      expect(createManyCall.data).toHaveLength(2);
      // mockCases[0] has currentVersion: 1, so version should be 2
      expect(createManyCall.data[0].version).toBe(2);
      // mockCases[1] has currentVersion: 2, so version should be 3
      expect(createManyCall.data[1].version).toBe(3);
    });

    it("skips version creation when createVersions is false", async () => {
      const mockCreateMany = vi.fn().mockResolvedValue({ count: 0 });
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: { createMany: mockCreateMany },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: {
            create: mockCreate,
            update: vi.fn(),
            deleteMany: mockDeleteMany,
          },
        });
      });

      const [request, context] = createRequest({
        caseIds: [1, 2],
        updates: {},
        stepsUpdates: {
          operation: "replace",
          newSteps: [
            { step: { type: "doc", content: [] }, expectedResult: { type: "doc", content: [] }, order: 0 },
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
            expectedResult: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"User is logged in"}]}]}',
            order: 0,
          },
        ],
      }));
      (prisma.repositoryCases.findMany as any).mockResolvedValue(casesWithSteps);

      const mockStepUpdate = vi.fn().mockResolvedValue({});
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: {
            create: vi.fn(),
            update: mockStepUpdate,
            deleteMany: vi.fn(),
          },
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
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      (prisma.$transaction as any).mockRejectedValue(new Error("DB Error"));

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
      (prisma.$transaction as any).mockImplementation(
        async (callback: any, options: any) => {
          // Verify extended timeout is passed
          expect(options.timeout).toBe(60000);
          return callback({
            repositoryCaseVersions: {
              createMany: vi.fn().mockResolvedValue({ count: 2 }),
            },
            repositoryCases: { update: vi.fn().mockResolvedValue({}) },
            caseFieldValues: {
              create: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
            steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
          });
        }
      );

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

      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        return callback({
          repositoryCaseVersions: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          repositoryCases: { update: vi.fn().mockResolvedValue({}) },
          caseFieldValues: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
          steps: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
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
      expect(prisma.projects.findFirst).toHaveBeenCalledWith({
        where: { id: 1, isDeleted: false },
      });
    });
  });
});
