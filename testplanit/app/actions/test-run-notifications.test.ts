import { describe, it, expect, vi, beforeEach } from "vitest";
import { notifyTestCaseAssignment, notifyBulkTestCaseAssignment } from "./test-run-notifications";
import { prisma } from "~/lib/prisma";
import { NotificationService } from "~/lib/services/notificationService";
import { getServerAuthSession } from "~/server/auth";

// Mock dependencies
vi.mock("~/lib/prisma", () => ({
  prisma: {
    testRunCases: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createNotification: vi.fn(),
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

describe("test-run-notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("notifyTestCaseAssignment", () => {
    const mockSession = {
      user: {
        id: "assigner-123",
        name: "John Doe",
      },
      expires: new Date().toISOString(),
    } as any;

    const mockTestRunCase = {
      id: 1,
      repositoryCase: {
        name: "Test Login Flow",
      },
      testRun: {
        id: 10,
        name: "Sprint 1 Testing",
        project: {
          id: 100,
          name: "E-Commerce App",
        },
      },
      repositoryCaseId: 1001,
    };

    it("should create notification when test case is assigned to a new user", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.testRunCases.findUnique).mockResolvedValue(mockTestRunCase as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: "Jane Smith" } as any);

      await notifyTestCaseAssignment(1, "assignee-456", null);

      expect(NotificationService.createNotification).toHaveBeenCalledWith({
        userId: "assignee-456",
        type: "WORK_ASSIGNED",
        title: "New Test Case Assignment",
        message: 'John Doe assigned you to test case "Test Login Flow" in project "E-Commerce App"',
        relatedEntityId: "1",
        relatedEntityType: "TestRunCase",
        data: expect.objectContaining({
          assignedById: "assigner-123",
          assignedByName: "John Doe",
          projectId: 100,
          projectName: "E-Commerce App",
          testRunId: 10,
          testRunName: "Sprint 1 Testing",
          testCaseId: 1001,
          testCaseName: "Test Login Flow",
          entityName: "Test Login Flow",
        }),
      });
    });

    it("should not create notification when assignee hasn't changed", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);

      await notifyTestCaseAssignment(1, "assignee-456", "assignee-456");

      expect(prisma.testRunCases.findUnique).not.toHaveBeenCalled();
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should not create notification when unassigning (null assignee)", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);

      await notifyTestCaseAssignment(1, null, "assignee-456");

      expect(prisma.testRunCases.findUnique).not.toHaveBeenCalled();
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should not create notification when session is not authenticated", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null);

      await notifyTestCaseAssignment(1, "assignee-456", null);

      expect(prisma.testRunCases.findUnique).not.toHaveBeenCalled();
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should handle missing test run case gracefully", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.testRunCases.findUnique).mockResolvedValue(null);

      await notifyTestCaseAssignment(1, "assignee-456", null);

      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.testRunCases.findUnique).mockRejectedValue(new Error("Database error"));

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await notifyTestCaseAssignment(1, "assignee-456", null);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to create test case assignment notification:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("notifyBulkTestCaseAssignment", () => {
    const mockSession = {
      user: {
        id: "assigner-123",
        name: "Admin User",
      },
      expires: new Date().toISOString(),
    } as any;

    const mockTestRunCases = [
      {
        id: 1,
        testRun: {
          id: 10,
          name: "Sprint 1 Testing",
          project: {
            id: 100,
            name: "E-Commerce App",
          },
        },
        repositoryCase: {
          name: "Login Test",
        },
        repositoryCaseId: 1001,
      },
      {
        id: 2,
        testRun: {
          id: 10,
          name: "Sprint 1 Testing",
          project: {
            id: 100,
            name: "E-Commerce App",
          },
        },
        repositoryCase: {
          name: "Checkout Test",
        },
        repositoryCaseId: 1002,
      },
      {
        id: 3,
        testRun: {
          id: 11,
          name: "Sprint 2 Testing",
          project: {
            id: 100,
            name: "E-Commerce App",
          },
        },
        repositoryCase: {
          name: "API Test",
        },
        repositoryCaseId: 2001,
      },
    ];

    it("should create bulk notification for multiple test case assignments", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.testRunCases.findMany).mockResolvedValue(mockTestRunCases as any);

      await notifyBulkTestCaseAssignment([1, 2, 3], "assignee-456", 100);

      expect(NotificationService.createNotification).toHaveBeenCalledWith({
        userId: "assignee-456",
        type: "WORK_ASSIGNED",
        title: "Multiple Test Cases Assigned",
        message: "Admin User assigned you 3 test cases",
        data: {
          assignedById: "assigner-123",
          assignedByName: "Admin User",
          testRunGroups: expect.arrayContaining([
            expect.objectContaining({
              testRunId: 10,
              testRunName: "Sprint 1 Testing",
              projectId: 100,
              projectName: "E-Commerce App",
              testCases: expect.arrayContaining([
                expect.objectContaining({
                  testRunCaseId: 1,
                  testCaseId: 1001,
                  testCaseName: "Login Test",
                }),
                expect.objectContaining({
                  testRunCaseId: 2,
                  testCaseId: 1002,
                  testCaseName: "Checkout Test",
                }),
              ]),
            }),
            expect.objectContaining({
              testRunId: 11,
              testRunName: "Sprint 2 Testing",
              projectId: 100,
              projectName: "E-Commerce App",
              testCases: expect.arrayContaining([
                expect.objectContaining({
                  testRunCaseId: 3,
                  testCaseId: 2001,
                  testCaseName: "API Test",
                }),
              ]),
            }),
          ]),
          count: 3,
          isBulkAssignment: true,
        },
      });
    });

    it("should group test cases by test run", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.testRunCases.findMany).mockResolvedValue(mockTestRunCases as any);

      await notifyBulkTestCaseAssignment([1, 2, 3], "assignee-456", 100);

      const notificationCall = vi.mocked(NotificationService.createNotification).mock.calls[0][0];
      const testRunGroups = notificationCall.data.testRunGroups;

      // Should have 2 groups (Sprint 1 and Sprint 2)
      expect(testRunGroups).toHaveLength(2);
      
      // Sprint 1 should have 2 test cases
      const sprint1Group = testRunGroups.find((g: any) => g.testRunId === 10);
      expect(sprint1Group.testCases).toHaveLength(2);
      
      // Sprint 2 should have 1 test case
      const sprint2Group = testRunGroups.find((g: any) => g.testRunId === 11);
      expect(sprint2Group.testCases).toHaveLength(1);
    });

    it("should not create notification when no assignee provided", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);

      await notifyBulkTestCaseAssignment([1, 2, 3], null, 100);

      expect(prisma.testRunCases.findMany).not.toHaveBeenCalled();
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should not create notification when session is not authenticated", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null);

      await notifyBulkTestCaseAssignment([1, 2, 3], "assignee-456", 100);

      expect(prisma.testRunCases.findMany).not.toHaveBeenCalled();
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("should handle empty test run cases gracefully", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(mockSession);
      vi.mocked(prisma.testRunCases.findMany).mockResolvedValue([]);

      await notifyBulkTestCaseAssignment([1, 2, 3], "assignee-456", 100);

      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });
  });
});